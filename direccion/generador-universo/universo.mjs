import fs from 'fs';
import {leerHoja} from './leerxlsx.mjs';

const norm = s => (s||"").toString().trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();

// --- localidades oficiales (georef) ---
const geo = JSON.parse(fs.readFileSync('loc1.json','utf8')).localidades;
const PROV_ALIAS = {"CABA":"CIUDAD AUTONOMA DE BUENOS AIRES","TIERRA DEL FUEGO":"TIERRA DEL FUEGO ANTARTIDA E ISLAS DEL ATLANTICO SUR"};
const LOC = new Map();           // "PROV|LOCALIDAD" -> [lat,lon]
const LOC_PROV = new Map();      // "PROV" -> [{n,lat,lon}]
for(const l of geo){
  const p=norm(l.provincia.nombre), n=norm(l.nombre);
  const ll=[+l.centroide.lat.toFixed(5), +l.centroide.lon.toFixed(5)];
  if(!LOC.has(p+"|"+n)) LOC.set(p+"|"+n, ll);
  if(!LOC_PROV.has(p)) LOC_PROV.set(p,[]);
  LOC_PROV.get(p).push({n,ll});
}
function buscarLoc(prov, loc){
  const p0=norm(prov), p=norm(PROV_ALIAS[p0]||p0), n=norm(loc);
  if(!n) return null;
  let hit=LOC.get(p+"|"+n); if(hit) return hit;
  const lista=LOC_PROV.get(p)||[];
  // "CIUDAD DE SANTA FE" ~ "SANTA FE": aceptamos que uno contenga al otro
  for(const c of lista) if(c.n===n) return c.ll;
  for(const c of lista) if(c.n.includes(n)||n.includes(c.n)) return c.ll;
  return null;
}

function cargar(file, fuente){
  const f=leerHoja(file), H=f[0];
  const i={id:H.indexOf('ESTABLECIMIENTO_ID'),nom:H.indexOf('ESTABLECIMIENTO_NOMBRE'),loc:H.indexOf('LOCALIDAD_NOMBRE'),
    prov:H.indexOf('PROVINCIA_NOMBRE'),dep:H.indexOf('DEPARTAMENTO_NOMBRE'),fin:H.indexOf('ORIGEN_FINANCIAMIENTO'),
    sig:H.indexOf('TIPOLOGIA_SIGLA'),tip:H.indexOf('TIPOLOGIA_NOMBRE'),dom:H.indexOf('DOMICILIO')};
  const out=[];
  for(let r=1;r<f.length;r++){
    const row=f[r]; if(!row||!row[i.nom]) continue;
    out.push({nom:row[i.nom].trim(), loc:(row[i.loc]||"").trim(), prov:(row[i.prov]||"").trim(),
      fin:(row[i.fin]||"").trim(), tip:(row[i.tip]||"").trim(), dom:(row[i.dom]||"").trim(), fuente});
  }
  return out;
}

const far = cargar('refar/xl/worksheets/sheet1.xml','farmacia');
const ins = cargar('refes/xl/worksheets/sheet1.xml','institucion');
console.log('REFAR:',far.length,'| REFES:',ins.length);

let ok=0, miss=0; const missLoc={};
for(const e of [...far,...ins]){
  const ll=buscarLoc(e.prov,e.loc);
  if(ll){ e.ll=ll; ok++; } else { miss++; const k=e.prov+' | '+e.loc; missLoc[k]=(missLoc[k]||0)+1; }
}
console.log('ubicados:',ok,'| sin ubicar:',miss,'('+(miss/(ok+miss)*100).toFixed(1)+'%)');
console.log('\ntop localidades sin ubicar:');
Object.entries(missLoc).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,n])=>console.log('  '+String(n).padStart(4),k));
fs.writeFileSync('universo_raw.json', JSON.stringify({far,ins}));
console.log('\nguardado universo_raw.json');
