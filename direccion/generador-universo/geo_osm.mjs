import fs from 'fs';
import {limpiarDireccion, norm} from './geocoder.mjs';
const geo=JSON.parse(fs.readFileSync('loc1.json','utf8')).localidades;
const LOCS=new Set(geo.map(g=>norm(g.nombre)));
const PROV_DE=new Map();
for(const g of geo){ const n=norm(g.nombre); if(!PROV_DE.has(n)) PROV_DE.set(n,new Set()); PROV_DE.get(n).add(g.provincia.nombre); }
const ALIAS={"ROSARIO SUD":"ROSARIO","ROSARIO NORTE":"ROSARIO","ROSARIOS":"ROSARIO","RSOARIO":"ROSARIO","BARRIO FISHERTON":"ROSARIO","BARRIO PARQUE":"ROSARIO","V GOBERNADOR GALVEZ":"VILLA GOBERNADOR GALVEZ","EMPALME":"EMPALME VILLA CONSTITUCION","SAN JERONIMO":"SAN JERONIMO SUD"};

const r=JSON.parse(fs.readFileSync('p_now.json','utf8')).result;
const sin=r.filter(p=>!(p.partner_latitude&&Math.abs(p.partner_latitude)>0.05));
const pend=[];
for(const p of sin){
  const d=limpiarDireccion(p.street); if(!d) continue;
  let loc=norm(p.city); loc=ALIAS[loc]||loc;
  if(!LOCS.has(loc)) loc="";                       // ciudad basura → la omitimos
  let prov=(p.state_id?p.state_id[1]:"").replace(/\s*\((AR|IT)\)$/,"");
  if(loc && PROV_DE.get(loc) && PROV_DE.get(loc).size===1) prov=[...PROV_DE.get(loc)][0];
  if(!loc && !prov) continue;
  pend.push({p, calle:d.calle, altura:d.altura, loc, prov});
}
console.log('a reintentar con OpenStreetMap:',pend.length);
const RES={}; let ok=0, i=0;
for(const x of pend){
  i++;
  const u=new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("format","json"); u.searchParams.set("limit","1");
  u.searchParams.set("countrycodes","ar");
  u.searchParams.set("street", x.altura+" "+x.calle);
  if(x.loc) u.searchParams.set("city", x.loc);
  if(x.prov) u.searchParams.set("state", x.prov);
  u.searchParams.set("addressdetails","1");
  try{
    const res=await fetch(u,{headers:{"User-Agent":"EyG-Core-Dashboard/1.0 (rosaint.ar@gmail.com)"}});
    const j=await res.json();
    if(j&&j[0]){
      const a=j[0].address||{};
      const road=norm(a.road||"");
      const pedida=norm(x.calle);
      // validamos que sea la misma calle (si no, es un centroide de ciudad y no sirve)
      const okCalle = road && (road.includes(pedida)||pedida.includes(road));
      if(okCalle && a.house_number){ RES[x.p.id]={lat:+(+j[0].lat).toFixed(6), lon:+(+j[0].lon).toFixed(6), calle:a.road, loc:a.city||a.town||a.village||""}; ok++; }
    }
  }catch(e){}
  process.stdout.write('\r  '+i+'/'+pend.length+' → '+ok+' exactos   ');
  await new Promise(r=>setTimeout(r,1120));
}
console.log('\nrecuperados con OSM:',ok);
fs.writeFileSync('clientes_geo_osm.json',JSON.stringify(RES));
