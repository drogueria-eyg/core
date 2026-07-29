import fs from 'fs';
import {limpiarDireccion, geocodificarSeguro, norm} from './geocoder.mjs';
const TODOS=JSON.parse(fs.readFileSync('universo_match.json','utf8'));
const PROV_DET=new Set(["SANTA FE","ENTRE RIOS","CORDOBA"]);
const lista=TODOS.filter(e=>e.ll && PROV_DET.has(norm(e.prov)));
console.log('establecimientos a ubicar exacto:',lista.length);
const pend=[];
for(const e of lista){
  const d=limpiarDireccion(e.dom);
  if(d) pend.push({e, q:d.q, prov:e.prov, loc:e.loc});
}
console.log('con domicilio utilizable:',pend.length,'('+Math.round(pend.length/lista.length*100)+'%)');
const RES={}; const LOTE=90; let ok=0;
for(let i=0;i<pend.length;i+=LOTE){
  const trozo=pend.slice(i,i+LOTE);
  try{
    const r=await geocodificarSeguro(trozo.map(x=>({q:x.q, provincia:x.prov, localidad:x.loc})));
    r.forEach((v,k)=>{ if(v){ RES[trozo[k].e.nom+'|'+trozo[k].e.dom+'|'+trozo[k].e.loc]=[v.lat,v.lon]; ok++; } });
  }catch(err){ console.log('\n  lote falló:',err.message); }
  process.stdout.write('\r  '+Math.min(i+LOTE,pend.length)+'/'+pend.length+' → '+ok+' exactos   ');
  await new Promise(r=>setTimeout(r,300));
}
console.log('\nEXACTOS:',ok,'de',lista.length,'('+Math.round(ok/lista.length*100)+'%)');
fs.writeFileSync('universo_geo.json',JSON.stringify(RES));
console.log('guardado universo_geo.json');
