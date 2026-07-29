import fs from 'fs';
import {limpiarDireccion, geocodificarSeguro, norm} from './geocoder.mjs';
const ALIAS={"ROSARIO SUD":"ROSARIO","ROSARIO NORTE":"ROSARIO","ROSARIOS":"ROSARIO","RSOARIO":"ROSARIO","BARRIO FISHERTON":"ROSARIO","BARRIO PARQUE":"ROSARIO","ROSARIO SANTA FE":"ROSARIO","V GOBERNADOR GALVEZ":"VILLA GOBERNADOR GALVEZ","CABA":"CIUDAD AUTONOMA DE BUENOS AIRES","CIUDAD DE BUENOS AIRES":"CIUDAD AUTONOMA DE BUENOS AIRES","BARRIO NUEVA CORDOBA":"CORDOBA","EMPALME":"EMPALME VILLA CONSTITUCION","SAN JERONIMO":"SAN JERONIMO SUD"};
// localidad -> provincia (para rescatar los que tienen la provincia mal cargada)
const geo=JSON.parse(fs.readFileSync('loc1.json','utf8')).localidades;
const PROV_DE=new Map();
for(const g of geo){ const n=norm(g.nombre); if(!PROV_DE.has(n)) PROV_DE.set(n,new Set()); PROV_DE.get(n).add(g.provincia.nombre); }

const parts=JSON.parse(fs.readFileSync('p_parts.json','utf8')).result;
const pend=[];
for(const p of parts){
  const d=limpiarDireccion(p.street);
  let loc=norm(p.city); loc=ALIAS[loc]||loc;
  const prov=(p.state_id?p.state_id[1]:"").replace(/\s*\((AR|IT)\)$/,"");
  pend.push({p, q:d?d.q:null, loc, prov});
}
const geocodificables=pend.filter(x=>x.q&&x.loc);
console.log('clientes:',parts.length,'| con dirección utilizable:',geocodificables.length);

const RES={}; const LOTE=90;
async function corrida(lista, usarProvInferida, etiqueta){
  let ok=0;
  for(let i=0;i<lista.length;i+=LOTE){
    const trozo=lista.slice(i,i+LOTE);
    const items=trozo.map(x=>{
      let prov=x.prov;
      if(usarProvInferida){ const s=PROV_DE.get(x.loc); prov = (s&&s.size===1)?[...s][0]:x.prov; }
      return {q:x.q, provincia:prov, localidad:x.loc};
    });
    try{
      const r=await geocodificarSeguro(items);
      r.forEach((v,k)=>{ if(v){ RES[trozo[k].p.id]=v; ok++; } });
    }catch(e){ console.log('  lote falló:',e.message); }
    process.stdout.write('\r  '+etiqueta+': '+Math.min(i+LOTE,lista.length)+'/'+lista.length+' → '+ok+' exactos   ');
    await new Promise(r=>setTimeout(r,350));
  }
  console.log('');
  return ok;
}
await corrida(geocodificables,false,'pasada 1');
const faltan=geocodificables.filter(x=>!RES[x.p.id]);
console.log('sin resolver tras la pasada 1:',faltan.length,'→ reintento deduciendo la provincia');
await corrida(faltan,true,'pasada 2');

const total=Object.keys(RES).length;
console.log('\nEXACTOS:',total,'de',parts.length,'clientes ('+Math.round(total/parts.length*100)+'%)');
console.log('de los que tenían dirección utilizable: '+Math.round(total/geocodificables.length*100)+'%');
fs.writeFileSync('clientes_geo.json',JSON.stringify(RES));
console.log('guardado clientes_geo.json');
