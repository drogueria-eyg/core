import fs from 'fs';
const norm = s => (s||"").toString().trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();
const RUIDO=/\b(FARMACIA|FARMACIAS|FCIA|SRL|S R L|SA|S A|SAS|S A S|SH|S H|DE|DEL|LA|EL|LOS|LAS|Y|E|HIJOS|HNOS|HERMANOS|SOCIEDAD|ANONIMA|LTDA|LIMITADA|CIA)\b/g;
const clave = s => norm(s).replace(RUIDO," ").replace(/\s+/g," ").trim();
const GENERICO=new Set(["PARQUE","CENTRO","NORTE","SUR","ESTE","OESTE","NUEVA","NUEVO","SAN","SANTA","CENTRAL","MODELO","ESPANOL","ESPANOLA","ITALIANO","ITALIANA","MUNICIPAL","PROVINCIAL","REGIONAL","GENERAL","MEDICA","MEDICO","SALUD","VIDA","CRUZ","PLAZA","MITRE","BELGRANO","SARMIENTO","MORENO","URQUIZA","ALBERDI","RIVADAVIA"]);

const UNI=JSON.parse(fs.readFileSync('universo_raw.json','utf8'));
const TODOS=[...UNI.far,...UNI.ins].filter(e=>e.ll);
const parts=JSON.parse(fs.readFileSync('p_parts.json','utf8')).result;
const ALIAS={"ROSARIO SUD":"ROSARIO","ROSARIO NORTE":"ROSARIO","ROSARIOS":"ROSARIO","RSOARIO":"ROSARIO","BARRIO FISHERTON":"ROSARIO","BARRIO PARQUE":"ROSARIO","ROSARIO SANTA FE":"ROSARIO","V GOBERNADOR GALVEZ":"VILLA GOBERNADOR GALVEZ","CABA":"CIUDAD AUTONOMA DE BUENOS AIRES","CIUDAD DE BUENOS AIRES":"CIUDAD AUTONOMA DE BUENOS AIRES","BARRIO NUEVA CORDOBA":"CORDOBA","EMPALME":"EMPALME VILLA CONSTITUCION","SAN JERONIMO":"SAN JERONIMO SUD"};

const porLoc=new Map();
for(const p of parts){
  let c=norm(p.city); c=ALIAS[c]||c; if(!c) continue;
  const cl=clave(p.name||""); if(!cl) continue;
  if(!porLoc.has(c)) porLoc.set(c,[]);
  porLoc.get(c).push({id:p.id,name:p.name||"",cl});
}
const toks=s=>s.split(" ").filter(x=>x.length>2);
const jac=(a,b)=>{const A=new Set(toks(a)),B=new Set(toks(b));if(!A.size||!B.size)return 0;let i=0;for(const x of A)if(B.has(x))i++;return i/(A.size+B.size-i);};
/* Conservador: un solo token debe ser largo y NO genérico ("Parque", "Centro"…).
   Si no, cruzamos apellidos comunes o palabras de relleno y marcamos clientes que no lo son. */
function coincide(a,b){
  if(!a||!b) return false;
  const ta=toks(a), tb=toks(b);
  if(!ta.length||!tb.length) return false;
  if(a===b){ if(ta.length===1) return ta[0].length>=6 && !GENERICO.has(ta[0]); return true; }
  if(ta.length>=2 && tb.length>=2 && jac(a,b)>=0.67) return true;
  const corto=a.length<=b.length?a:b, largo=a.length<=b.length?b:a;
  const tc=toks(corto);
  if(corto.length>=8 && tc.length>=2 && largo.includes(corto)) return true;
  return false;
}
let match=0; const ej=[];
for(const e of TODOS){
  const cands=porLoc.get(norm(e.loc)); if(!cands) continue;
  const ce=clave(e.nom); if(!ce) continue;
  for(const c of cands){ if(coincide(c.cl,ce)){ e.cliente=c.id; match++; if(ej.length<14) ej.push(e.nom+'  ⇄  '+c.name); break; } }
}
console.log('identificados como clientes (criterio conservador):',match);
console.log('\nejemplos:'); ej.forEach(x=>console.log('  '+x));
fs.writeFileSync('universo_match.json',JSON.stringify(TODOS));
console.log('\nguardado universo_match.json');
