/* CORRE LA PANTALLA DE RENTABILIDAD COMERCIAL DE VERDAD, contra los datos reales de Odoo.
     node pruebas/rentabilidad.mjs

   Necesita la llave del conector (ver [[eyg-odoo-rpc-candado]]): el archivo
   C:\Users\diego\.eyg-odoo-connector-key, o la variable de entorno EYG_CONNECTOR_KEY.
   Sin llave no falla: avisa y se saltea, para que no rompa una corrida en otra máquina.

   POR QUÉ EXISTE: no alcanza con que el archivo esté bien escrito. Los errores que llegaron a
   producción en esta pantalla eran de EJECUCIÓN y recién aparecían al abrirla. Esto la abre, le
   da los datos reales y comprueba que los números cierren entre sí. */
import fs from "fs";
import { fileURLToPath } from "url";
const R = fileURLToPath(new URL("../", import.meta.url));

/* ── la llave ── */
let KEY = process.env.EYG_CONNECTOR_KEY || "";
if(!KEY){
  for(const p of ["C:/Users/diego/.eyg-odoo-connector-key", (process.env.USERPROFILE||process.env.HOME||"")+"/.eyg-odoo-connector-key"]){
    try{ KEY = fs.readFileSync(p,"utf8").trim(); if(KEY) break; }catch(e){}
  }
}
if(!KEY){
  console.log("⊘ sin llave del conector: la prueba se saltea.");
  console.log("  Poné EYG_CONNECTOR_KEY o dejá el archivo .eyg-odoo-connector-key en tu carpeta de usuario.");
  process.exit(0);
}
const URL_RPC="https://yxotopoklgjowcudveoj.supabase.co/functions/v1/odoo-rpc";
const rpc=async(model,method,args,kwargs={})=>{
  for(let i=0;i<4;i++){
    try{
      const r=await fetch(URL_RPC,{method:"POST",headers:{"Content-Type":"application/json","x-connector-key":KEY},
        body:JSON.stringify({model,method,args,kwargs})});
      const j=await r.json();
      if(!j.ok) throw new Error(typeof j.error==="string"?j.error:JSON.stringify(j.error));
      return j.result;
    }catch(e){ if(i===3) throw e; await new Promise(s=>setTimeout(s,1500*(i+1))); }
  }
};

/* ── un navegador mínimo: la pantalla escribe HTML y lee campos ── */
const nodos={};
const nn=id=>({id,value:"",checked:false,innerHTML:"",outerHTML:"",className:"",style:{},scrollIntoView(){},appendChild(){}});
globalThis.window=globalThis;
globalThis.document={ getElementById:id=>nodos[id]||null, createElement:()=>nn("x"), head:{appendChild(){}},
  get body(){ return nodos.__body||(nodos.__body=nn("body")); } };
globalThis.alert=m=>console.log("    (aviso) "+m);
globalThis.confirm=()=>true;
globalThis.EYG={
  rpc:(m,me,a,k)=>rpc(m,me,a,k||{}), supa:()=>({}),
  money:n=>"$"+Math.round(n||0).toLocaleString("es-AR"),
  esc:s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])),
  argToday:()=>new Date().toISOString().slice(0,10),
  /* guard() no resuelve a propósito: así la pantalla no arranca sola y la prueba manda el período */
  guard:()=>new Promise(()=>{}),
  layout:(p,k,cuerpo)=>{ nodos.cap=nn("cap"); nodos.cap.outerHTML=cuerpo; return cuerpo; },
};

const html=fs.readFileSync(R+"comercial/rentabilidad.html","utf8");
const bloques=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
if(bloques.length!==1) throw new Error("esperaba un solo bloque <script>, hay "+bloques.length);
new Function(bloques[0]+"\n;globalThis.__A={cargar,render,filas,sumar,costoDe,sueldoDe,aportesDe,"+
  "get DATOS(){return DATOS;},get COMIS(){return COMIS;},ST,get CFG(){return CFG;},set CFG(v){CFG=v;}};")();
const A=globalThis.__A;
/* En el navegador este nodo lo crea EYG.layout() al arrancar la pantalla; acá guard() no resuelve
   a propósito (para mandar el período a mano), así que se crea igual para que render() tenga dónde
   escribir. render() reemplaza outerHTML: en el navegador cambia el nodo, acá queda el texto. */
nodos.cap=nn("cap");

let fallas=0;
const probar=async(t,fn)=>{ try{ await fn(); console.log("  ✓ "+t); }catch(e){ fallas++; console.log("  ✗ "+t+"  →  "+e.message); } };

/* el período: los dos meses cerrados anteriores al actual */
const hoy=new Date(); const mes=d=>d.toISOString().slice(0,7);
const atras=n=>{ const d=new Date(hoy); d.setMonth(d.getMonth()-n); return mes(d); };
A.ST.desde=atras(2); A.ST.hasta=atras(1);
console.log("PANTALLA DE RENTABILIDAD · "+A.ST.desde+" a "+A.ST.hasta+"\n");

await probar("lee el período contra Odoo", async()=>{ await A.cargar(); });
await probar("arma el HTML completo sin romperse", async()=>{
  A.render();
  const h=nodos.cap.outerHTML||"";
  if(h.length<2000) throw new Error("salió muy corto: "+h.length+" caracteres");
  if(/undefined|NaN/.test(h)) throw new Error("muestra 'undefined' o 'NaN'");
});
await probar("los totales son la suma de las filas", async()=>{
  const F=A.filas(), T=A.sumar(F);
  const sv=F.reduce((a,f)=>a+f.venta,0), sm=F.reduce((a,f)=>a+f.margen,0);
  if(Math.abs(T.venta-sv)>1) throw new Error("el total de venta no es la suma");
  if(Math.abs(T.margen-sm)>1) throw new Error("el total de margen no es la suma");
  for(const f of F) if(Math.abs((f.margen-f.costoTotal)-f.neto)>1) throw new Error(f.nombre+": margen − costo ≠ lo que queda");
});
await probar("las porciones de la torta suman el margen", async()=>{
  const F=A.filas(), T=A.sumar(F);
  const s=k=>F.reduce((a,f)=>a+(f.costo[k]||0),0);
  const partes=s("comi")+s("bruto")+s("sac")+s("patronales")+s("art")+s("vacaciones")+s("otros")+s("impuestos")+s("viaticos");
  const queda=T.margen-T.costoTotal;
  if(Math.abs(partes+queda-T.margen)>1) throw new Error("las porciones no suman el margen: faltan "+Math.round(T.margen-partes-queda));
});
await probar("cada período se arma sin fallar", async()=>{
  for(const n of [1,3,6]){
    A.ST.desde=atras(n); A.ST.hasta=atras(1);
    await A.cargar(); A.render();
    if(!(nodos.cap.outerHTML||"").length) throw new Error("el período de "+n+" meses quedó vacío");
  }
  A.ST.desde=atras(2); A.ST.hasta=atras(1); await A.cargar();
});
await probar("el desglose de una comercial se abre", async()=>{
  const F=A.filas(); if(!F.length) throw new Error("no hay comerciales con datos en el período");
  A.ST.abierta=F[0].uid; A.render();
  if(!(nodos.cap.outerHTML||"").includes("de dónde sale el número")) throw new Error("no apareció el desglose");
  A.ST.abierta=null;
});
await probar("el costo responde a los sueldos cargados", async()=>{
  const uid=A.filas()[0].uid, guardado=A.CFG.personas[String(uid)];
  A.CFG.personas[String(uid)]={nombre:"x",sueldos:[],viaticos:0,regimen:"relacion"};
  const sin=A.costoDe(uid,A.ST.hasta,1000000).total;
  A.CFG.personas[String(uid)]={nombre:"x",sueldos:[{desde:"2026-01",bruto:2000000}],viaticos:0,regimen:"relacion"};
  const con=A.costoDe(uid,A.ST.hasta,1000000);
  if(!(con.total>sin)) throw new Error("cargar un sueldo no movió el costo");
  const suma=con.bruto+con.comi+con.sac+con.patronales+con.art+con.otros+(con.impuestos||0)+con.vacaciones+con.viaticos;
  if(Math.abs(suma-con.total)>0.01) throw new Error("el desglose no suma el total");
  A.CFG.personas[String(uid)]=guardado;
});
await probar("la monotributista no paga cargas", async()=>{
  const uid=A.filas()[0].uid, guardado=A.CFG.personas[String(uid)];
  A.CFG.personas[String(uid)]={nombre:"x",regimen:"monotributo",viaticos:400000,
    sueldos:[{desde:"2026-01",bruto:1500000,aportes:100000}]};
  const c=A.costoDe(uid,A.ST.hasta,800000);
  if(c.patronales||c.art||c.sac) throw new Error("le aplicó cargas a una monotributista");
  if(Math.abs(c.total-(1500000+800000+100000+400000))>0.01) throw new Error("el total no es honorarios + impuestos + comisión + viáticos");
  A.CFG.personas[String(uid)]={nombre:"x",regimen:"relacion",viaticos:400000,sueldos:[{desde:"2026-01",bruto:1500000}]};
  if(!(A.costoDe(uid,A.ST.hasta,800000).total>c.total*1.2)) throw new Error("en relación de dependencia debería costar bastante más");
  A.CFG.personas[String(uid)]=guardado;
});
await probar("la vigencia del sueldo respeta el pasado", async()=>{
  const uid=A.filas()[0].uid, guardado=A.CFG.personas[String(uid)];
  A.CFG.personas[String(uid)]={nombre:"x",regimen:"relacion",viaticos:0,
    sueldos:[{desde:"2026-01",bruto:1000000},{desde:"2026-10",bruto:1500000}]};
  if(A.sueldoDe(uid,"2026-09")!==1000000) throw new Error("septiembre debería usar el sueldo viejo");
  if(A.sueldoDe(uid,"2026-10")!==1500000) throw new Error("octubre debería usar el nuevo");
  if(A.sueldoDe(uid,"2025-12")!==0) throw new Error("antes de la primera vigencia debería dar 0");
  A.CFG.personas[String(uid)]=guardado;
});
await probar("avisa cuando falta el sueldo de un mes", async()=>{
  A.render();
  const F=A.filas(), h=nodos.cap.outerHTML||"";
  const falta=F.filter(f=>(f.sinSueldo||[]).length);
  if(falta.length && !/Falta el sueldo/.test(h)) throw new Error("hay meses sin sueldo y no lo avisa");
  if(!falta.length && /Falta el sueldo/.test(h)) throw new Error("avisa que falta un sueldo cuando no falta");
  for(const f of falta) for(const m of f.sinSueldo)
    if(A.sueldoDe(f.uid,m)!==0) throw new Error(f.nombre+": marcado sin sueldo en "+m+" pero tiene uno");
});

console.log("\n"+(fallas?"⚠ "+fallas+" prueba(s) fallaron":"✓ la pantalla corre con datos reales y los números cierran"));
process.exit(fallas?1:0);
