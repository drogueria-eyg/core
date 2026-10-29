/* ARMA LA HOJA DE LIQUIDACIÓN DE VERDAD, con meses de prueba. No toca Odoo ni la red.
     node pruebas/hoja-liquidacion.mjs

   POR QUÉ EXISTE: cuatro veces salió a producción una hoja que cortaba al abrirla —`data is not
   defined`, `_freno is not defined`, `fD is not defined`— y ninguna la vio `node --check`: son
   errores de EJECUCIÓN, y viven dentro de interpolaciones de texto `${...}`, donde el análisis
   estático se pierde. Esto las ejecuta. Si la hoja no se arma, falla acá y no en la pantalla de
   Dirección con una comercial esperando su liquidación. */
import fs from "fs";
import { fileURLToPath } from "url";
const R = fileURLToPath(new URL("../", import.meta.url));

/* ── el navegador, lo mínimo que el módulo toca al cargarse ── */
globalThis.window = globalThis;
globalThis.document = { getElementById:()=>null, createElement:()=>({style:{},appendChild(){}}), head:{appendChild(){}} };
globalThis.EYG = {
  rpc: async()=>[],
  domVendedor:(p,uid)=>[[p+"user_id","=",uid]],
  argToday:()=>"2026-11-03",
  esc:s=>String(s==null?"":s),
  money:n=>"$"+Math.round(n||0),
  paqueteRige:(mes,cfg)=>!cfg||!cfg.paqueteDesde||String(mes)>=String(cfg.paqueteDesde),
  tasasDe:(mes,cfg)=>(cfg&&cfg.rates)||{},
  reglasDe:(mes,cfg)=>({rates:(cfg&&cfg.rates)||{}}),
  moraIndice:()=>0, moraResta:()=>0,
  perfilDe:()=>"farm",
  metaDesde:()=>({baseline:0,meta:0,meses:[],minimo:null}),
  COMI_DEF:{ rates:{inst:{base:.02,high:.03},farm:{base:.023,high:.028},externo:{base:.03,high:.04}} },
};

const codigo = fs.readFileSync(R+"assets/liquidacion.js","utf8");
new Function(codigo)();
const LIQ = globalThis.EYGLIQ;
if(!LIQ){ console.log("✗ el módulo no expuso EYGLIQ"); process.exit(1); }

/* ── una fila con la forma que guarda un cierre real ── */
const fila = (nombre, perfil, extras={}) => Object.assign({
  uid:1, nombre, perfil, perfilNom: perfil==="inst"?"Instituciones":"Farmacias / Comercial",
  equipo:"", ticket:150000,
  ventana:[{key:"2026-08",net:40e6},{key:"2026-09",net:45e6},{key:"2026-10",net:50e6}],
  baseline:45e6, meta:56.25e6, corte:56.25e6,
  facturas:62e6, nc:2e6, facturasIVA:75e6, ncIVA:2.4e6, neto:60e6, ramaA:60e6, ramaB:0,
  tasaTeorica:{base:.023,high:.028}, tasaAplicada:{base:.0215,high:.0265},
  t1:56.25e6, t2:3.75e6, comiBase:1.3e6, comiFinal:1.4e6,
  nivel:{ pts:72.5, idx:2, mult:1.10, nombre:"Oro", emoji:"🥇",
    crudo:{ nuevosDetalle:[
      {id:1,nombre:"Farmacia Prueba",alta:"2026-11-03",pedidos:2,monto:900000,compro:true},
      {id:2,nombre:"Farmacia Sin Comprar",alta:"2026-11-07",pedidos:0,monto:0,compro:false}] },
    items:[{ic:"💰",lab:"Cobro vs objetivo de cobranza",max:20,pts:14,det:"cobró $18.000.000 de $25.000.000 (72%)"},
           {ic:"📞",lab:"Actividad (pedidos y clientes)",max:20,pts:18,det:"180 pedidos y 55 clientes = 90%"},
           {ic:"📤",lab:"Ofertas enviadas",max:8,pts:5.3,det:"20 de 30"},
           {ic:"🎁",lab:"Ofertas vendidas",max:17,pts:10.2,det:"6 clientes de 10"},
           {ic:"🆕",lab:"Clientes nuevos",max:20,pts:14,det:"3 de 5 que compraron  ·  5 altas sin comprar"},
           {ic:"🔥",lab:"Constancia (15 contactos/día)",max:5,pts:3.7,det:"11 contactos el 2026-11-02"},
           {ic:"📅",lab:"Mínimo de venta semanal",max:10,pts:7.5,det:"3 de 4 semanas al mínimo"}]},
  salud:{ salud:85, penaltyPt:0.15, venc:0.12, fichas:0.55, factRatio:1.14, moraIndice:0.32,
    items:[{ic:"🩸",lab:"Mora de sus ventas",resta:9,max:60,det:"$3.000.000 vencido de $25.000.000 · índice 0,32"},
           {ic:"📉",lab:"Mínimo de venta del mes",resta:0,max:30,det:"$60.000.000 de $52.500.000 = 114%"},
           {ic:"🗂️",lab:"Fichas completas",resta:6,max:10,det:"55% de la cartera"}]},
}, extras);

const RATES={inst:{base:.02,high:.03},farm:{base:.023,high:.028},externo:{base:.03,high:.04}};
const CFG_NUEVA={ paqueteDesde:"2026-10", nivelSoloTramoBase:true, metaMetodo:"mediana", metaMeses:3,
  metaCrecimiento:0.25, rates:RATES };
const CFG_VIEJA={ metaMetodo:"mediana", metaMeses:3, metaCrecimiento:0.20,
  rates:{inst:{base:.02,high:.03},farm:{base:.025,high:.035},externo:{base:.03,high:.04}} };

const CASOS=[
  ["mes nuevo, cerrado",   {mes:"2026-11",config:CFG_NUEVA,generado:"2026-12-01",liquidadoEl:"2026-12-01",comerciales:[fila("Antonella","farm"),fila("Natividad","inst")],excluidosComprobantes:[]}, true],
  ["mes nuevo, abierto",   {mes:"2026-11",config:CFG_NUEVA,generado:"2026-11-03",comerciales:[fila("Antonella","farm")],excluidosComprobantes:[]}, false],
  ["mes VIEJO, cerrado",   {mes:"2026-09",config:CFG_VIEJA,generado:"2026-09-30",liquidadoEl:"2026-09-30",comerciales:[fila("Antonella","farm")],excluidosComprobantes:[]}, true],
  ["externo (sin nivel)",  {mes:"2026-11",config:CFG_NUEVA,generado:"2026-12-01",comerciales:[fila("Samanta","externo",{nivel:null,salud:null,perfilNom:"Externo",comiFinal:-14000,neto:-459248})],excluidosComprobantes:[]}, true],
  ["con comprobantes excluidos", {mes:"2026-11",config:CFG_NUEVA,generado:"2026-12-01",comerciales:[fila("Antonella","farm")],
      excluidosComprobantes:[{nombre:"NC A-0001-00012345",cliente:"Farmacia X",comercial:"Antonella",neto:120000,motivo:"de un mes anterior"}]}, true],
  ["sin comerciales",      {mes:"2026-11",config:CFG_NUEVA,generado:"2026-12-01",comerciales:[],excluidosComprobantes:[]}, true],
  ["sin detalle de nuevos (cierre viejo)", {mes:"2026-09",config:CFG_VIEJA,generado:"2026-09-30",liquidadoEl:"2026-09-30",
      comerciales:[fila("Claudia","farm",{nivel:Object.assign({},fila("x","farm").nivel,{crudo:{}})})],excluidosComprobantes:[]}, true],
];

let fallas=0;
for(const [titulo, datos, cerrado] of CASOS){
  try{
    const html=LIQ.docHTML(datos, cerrado);
    if(typeof html!=="string" || html.length<500) throw new Error("la hoja salió vacía o muy corta ("+(html||"").length+" caracteres)");
    if(/undefined|NaN/.test(html)) throw new Error("la hoja muestra 'undefined' o 'NaN'");
    console.log("  ✓ "+titulo.padEnd(38)+html.length+" caracteres");
  }catch(e){ fallas++; console.log("  ✗ "+titulo.padEnd(38)+e.message); }
}
/* el texto tiene que decir las tasas del mes que se liquida, no las de hoy */
try{
  const h=LIQ.docHTML(CASOS[2][1], true);
  if(!/2,5/.test(h)) throw new Error("un mes de septiembre debería mostrar las tasas de entonces (2,5/3,5)");
  const n=LIQ.docHTML(CASOS[0][1], true);
  if(!/2,3/.test(n)) throw new Error("un mes nuevo debería mostrar 2,3%");
  console.log("  ✓ "+"cada hoja dice las tasas de SU mes".padEnd(38));
}catch(e){ fallas++; console.log("  ✗ cada hoja dice las tasas de SU mes      "+e.message); }

console.log("\n"+(fallas?"⚠ "+fallas+" caso(s) no arman la hoja — la pantalla de Dirección cortaría igual":"✓ la hoja se arma en todos los casos"));
process.exit(fallas?1:0);
