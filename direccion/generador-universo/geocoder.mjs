import fs from 'fs';
export const norm = s => (s||"").toString().trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();

/* Limpia la dirección: saca piso/depto/local y prefijos de vía, y deja "CALLE ALTURA".
   Sin esto el servicio no encuentra la calle o, peor, engancha otra parecida. */
export function limpiarDireccion(s){
  let t=" "+norm(s)+" ";
  if(!t.trim()) return null;
  if(/^(SIN DATOS|S D|NO TIENE|SMMMF|X|\-)$/.test(t.trim())) return null;
  t=t.replace(/\s(PB|PISO|PISOS|P|DTO|DPTO|DEPTO|DEPARTAMENTO|LOCAL|OF|OFICINA|TORRE|MANZANA|MZA|CASA|BIS|ESQ|ESQUINA|ENTRE)\s.*$/,' ');
  t=t.replace(/\s(N|NRO|NUM|NUMERO)\s+(\d)/,' $2');
  t=t.replace(/^\s*(AV|AVDA|AVENIDA|BV|BVD|BOULEVARD|BLVD|CALLE|PJE|PASAJE|DR|DRA|GRAL|PTE)\s+/,' ');
  t=t.replace(/\s+/g,' ').trim();
  const m=t.match(/^(.*?)\s+(\d{1,6})\b/);
  if(!m) return null;                       // sin altura no hay punto exacto
  const calle=m[1].trim(), altura=m[2];
  if(calle.length<3) return null;
  return {calle, altura, q:calle+" "+altura};
}
const _tk=s=>norm(s).split(" ").filter(x=>x.length>1);
/* el registro escribe "AV SAN MARTIN" y nosotros "SAN MARTIN": es la misma calle */
const sinVia = s => norm(s).replace(/^(AV|AVDA|AVENIDA|BV|BVD|BOULEVARD|CALLE|PJE|PASAJE|RUTA|RN|RP|DR|DRA|GRAL|PTE|SGTO|CNEL)\s+/,'').replace(/\s+(BIS|A|B)$/,'').trim();
/* ¿La calle que devolvió el servicio es la misma que pedimos? Evita que
   "LOS MAITENES" termine en "EL MAITEN" (otra calle, otro lugar). */
export function calleCoincide(pedida, devuelta){
  const a=sinVia(pedida), b=sinVia(devuelta);
  if(!a||!b) return false;
  if(a===b) return true;
  const A=new Set(_tk(a)), B=new Set(_tk(b));
  if(!A.size||!B.size) return false;
  let i=0; for(const x of A) if(B.has(x)) i++;
  const jac=i/(A.size+B.size-i);
  if(jac>=0.8) return true;
  return (a.length>=6 && b.length>=6 && (a.startsWith(b)||b.startsWith(a)));
}
/* Si un solo registro viene mal, el servicio rechaza TODO el lote (HTTP 400).
   Partimos a la mitad hasta aislar al culpable y salvar el resto. */
export async function geocodificarSeguro(items){
  if(!items.length) return [];
  try{ return await geocodificarLote(items); }
  catch(e){
    if(items.length===1) return [null];
    const m=Math.floor(items.length/2);
    const a=await geocodificarSeguro(items.slice(0,m));
    const b=await geocodificarSeguro(items.slice(m));
    return a.concat(b);
  }
}
export async function geocodificarLote(items){
  // items: [{q, provincia, localidad}] → devuelve [{lat,lon,calle,loc} | null]
  const body={direcciones: items.map(x=>{
    const o={direccion:x.q, max:1};
    if(x.provincia) o.provincia=x.provincia;
    if(x.localidad) o.localidad_censal=x.localidad;
    return o;
  })};
  const r=await fetch("https://apis.datos.gob.ar/georef/api/direcciones",{
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
  if(!r.ok) throw new Error("HTTP "+r.status);
  const j=await r.json();
  return (j.resultados||[]).map((res,i)=>{
    const d=(res.direcciones||[])[0];
    if(!d||!d.ubicacion||d.ubicacion.lat==null) return null;
    const pedida=items[i].q.replace(/\s+\d+$/,"");
    if(!calleCoincide(pedida, (d.calle||{}).nombre||"")) return null;   // descartamos el difuso
    const lc=norm((d.localidad_censal||{}).nombre||"");
    if(items[i].localidad && lc && lc!==norm(items[i].localidad)) return null;
    return {lat:+d.ubicacion.lat.toFixed(6), lon:+d.ubicacion.lon.toFixed(6),
            calle:(d.calle||{}).nombre, loc:(d.localidad_censal||{}).nombre};
  });
}
