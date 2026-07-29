import fs from 'fs';
const norm = s => (s||"").toString().trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();

/* Deja lindo el nombre OFICIAL para mostrar: los registros vienen en MAYÚSCULAS.
   Respeta siglas (SA, SRL, SAMCO…), pone en minúscula los enlaces (de, del, la, y)
   y no toca los números romanos ni las iniciales. */
const SIGLAS=new Set(["SA","SRL","SAS","SH","SCS","SAMCO","SAMCo","OSPE","PAMI","IAPOS","UTN","UNR","IPS","ART","OSDE","SEM","UDP","CIC","CAPS","SIES","ONG","ACA","EPE","CEMAR","IRAM","INCUCAI","AMR","APROSS","DASU","ISSN","IOMA","OSPIL","II","III","IV","VI","VII","VIII","IX","XI","XII"]);
const MINUS=new Set(["DE","DEL","LA","LAS","LOS","EL","Y","E","EN","A","AL","POR","PARA","CON","SAN","SANTA"]); // san/santa se corrigen abajo
const lindo = s => {
  let t=(s||"").replace(/\s+/g," ").trim();
  if(!t) return "";
  const pal=t.split(" ").map((w,i)=>{
    const u=w.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ0-9]/g,"");
    if(SIGLAS.has(u)) return w.toUpperCase();
    if(TILDES[u]) return (i>0||true)?TILDES[u]:TILDES[u];
    if(/^\d+$/.test(w)) return w;
    if(w.length<=1) return w.toUpperCase();
    const low=w.toLowerCase();
    if(i>0 && MINUS.has(u) && u!=="SAN" && u!=="SANTA") return low;
    return low.charAt(0).toUpperCase()+low.slice(1);
  });
  return pal.join(" ").replace(/\s+,/g,",").replace(/\s{2,}/g," ").trim();
};


/* El padrón viene sin tildes. Corregimos SOLO palabras genéricas del rubro y
   nombres de santo/pila muy frecuentes; nunca apellidos (ahí no podemos saber). */
const TILDES={ANALISIS:'Análisis',CLINICO:'Clínico',CLINICA:'Clínica',CLINICOS:'Clínicos',CLINICAS:'Clínicas',
MEDICO:'Médico',MEDICA:'Médica',MEDICOS:'Médicos',MEDICAS:'Médicas',ATENCION:'Atención',DIAGNOSTICO:'Diagnóstico',
IMAGENES:'Imágenes',GERIATRICO:'Geriátrico',GERIATRICA:'Geriátrica',PEDIATRICO:'Pediátrico',PEDIATRICA:'Pediátrica',
CARDIOLOGIA:'Cardiología',ONCOLOGIA:'Oncología',ONCOLOGICO:'Oncológico',TRAUMATOLOGIA:'Traumatología',
OFTALMOLOGIA:'Oftalmología',PSIQUIATRICO:'Psiquiátrico',REHABILITACION:'Rehabilitación',NUTRICION:'Nutrición',
INTERNACION:'Internación',FARMACEUTICO:'Farmacéutico',FARMACEUTICA:'Farmacéutica',CIRUGIA:'Cirugía',
RADIOLOGIA:'Radiología',TOMOGRAFIA:'Tomografía',ECOGRAFIA:'Ecografía',KINESIOLOGIA:'Kinesiología',
FONOAUDIOLOGIA:'Fonoaudiología',ODONTOLOGIA:'Odontología',PSICOLOGIA:'Psicología',GINECOLOGIA:'Ginecología',
NEUROLOGIA:'Neurología',NEFROLOGIA:'Nefrología',UROLOGIA:'Urología',DIALISIS:'Diálisis',PUBLICO:'Público',
PUBLICA:'Pública',ADMINISTRACION:'Administración',ASOCIACION:'Asociación',FUNDACION:'Fundación',
FEDERACION:'Federación',PROTECCION:'Protección',ATENCIÓN:'Atención',PROVISION:'Provisión',
JOSE:'José',MARIA:'María',NICOLAS:'Nicolás',ANDRES:'Andrés',TOMAS:'Tomás',MARTIN:'Martín',RAMON:'Ramón',
SEBASTIAN:'Sebastián',JULIAN:'Julián',ADRIAN:'Adrián',HECTOR:'Héctor',VICTOR:'Víctor',ANGEL:'Ángel',
ANGELA:'Ángela',INES:'Inés',JESUS:'Jesús',BELEN:'Belén',CONCEPCION:'Concepción',ASUNCION:'Asunción',
GERMAN:'Germán',JOAQUIN:'Joaquín',RAFAEL:'Rafael',SIMON:'Simón',ROMAN:'Román'};

// Nombres BIEN escritos de localidad y provincia: los toma el servicio oficial
// de georreferenciación (georef), no el padrón (que viene en mayúsculas sin tildes).
const geo=JSON.parse(fs.readFileSync('loc1.json','utf8')).localidades;
const NOMBRE_LOC=new Map(), NOMBRE_PROV=new Map();
for(const g of geo){
  const p=norm(g.provincia.nombre), n=norm(g.nombre);
  if(!NOMBRE_LOC.has(p+'|'+n)) NOMBRE_LOC.set(p+'|'+n, g.nombre);
  if(!NOMBRE_PROV.has(p)) NOMBRE_PROV.set(p, g.provincia.nombre);
}
const P_ALIAS={'CABA':'CIUDAD AUTONOMA DE BUENOS AIRES','TIERRA DEL FUEGO':'TIERRA DEL FUEGO ANTARTIDA E ISLAS DEL ATLANTICO SUR'};
const provOficial = p => NOMBRE_PROV.get(norm(P_ALIAS[norm(p)]||p)) || lindo(p);
function locOficial(prov,loc){
  const p=norm(P_ALIAS[norm(prov)]||prov), n=norm(loc);
  let h=NOMBRE_LOC.get(p+'|'+n); if(h) return h;
  for(const [k,v] of NOMBRE_LOC){ if(!k.startsWith(p+'|')) continue; const kn=k.slice(p.length+1);
    if(kn===n||kn.includes(n)||n.includes(kn)) return v; }
  return lindo(loc);
}
const TODOS=JSON.parse(fs.readFileSync('universo_match.json','utf8'));
const parts=JSON.parse(fs.readFileSync('p_parts.json','utf8')).result;
const ALIAS={"ROSARIO SUD":"ROSARIO","ROSARIO NORTE":"ROSARIO","ROSARIOS":"ROSARIO","RSOARIO":"ROSARIO","BARRIO FISHERTON":"ROSARIO","BARRIO PARQUE":"ROSARIO","ROSARIO SANTA FE":"ROSARIO","V GOBERNADOR GALVEZ":"VILLA GOBERNADOR GALVEZ","CABA":"CIUDAD AUTONOMA DE BUENOS AIRES","CIUDAD DE BUENOS AIRES":"CIUDAD AUTONOMA DE BUENOS AIRES","BARRIO NUEVA CORDOBA":"CORDOBA","EMPALME":"EMPALME VILLA CONSTITUCION","SAN JERONIMO":"SAN JERONIMO SUD"};

// --- agregado por localidad (todo el país) ---
const L=new Map();
for(const e of TODOS){
  const k=norm(e.prov)+"|"+norm(e.loc);
  if(!L.has(k)) L.set(k,{loc:locOficial(e.prov,e.loc),prov:provOficial(e.prov),ll:e.ll,f:0,i:0,n:0});
  const o=L.get(k); if(e.fuente==='farmacia') o.f++; else o.i++;
}
for(const p of parts){
  let c=norm(p.city); c=ALIAS[c]||c; if(!c) continue;
  const k=norm((p.state_id?p.state_id[1]:"").replace(/\s*\((AR|IT)\)$/,""))+"|"+c;
  if(L.has(k)) L.get(k).n++;
}
const locs=[...L.entries()].map(([k,v])=>({k,...v}));
const idx=new Map(); locs.forEach((l,i)=>idx.set(l.k,i));

// --- individuales: provincias donde EyG ya opera + vecinas ---
const PROV_DET=new Set(["SANTA FE","ENTRE RIOS","CORDOBA"]);
const est=[];
const nombresOficiales={};
for(const e of TODOS){
  if(!PROV_DET.has(norm(e.prov))) continue;
  const i=idx.get(norm(e.prov)+"|"+norm(e.loc)); if(i===undefined) continue;
  let nom=lindo(e.nom);
  if(e.fuente==='farmacia' && !/farmacia/i.test(nom)) nom="Farmacia "+nom;   // REFAR = registro de farmacias
  est.push([nom, i, e.fuente==='farmacia'?0:1, lindo(e.dom||""), e.cliente||0]);
  if(e.cliente) nombresOficiales[e.cliente]=nom;
}
const OUT={
  generado:"2026-07-28",
  fuente:"Registro Federal de Farmacias (REFAR) y de Establecimientos de Salud (REFES) — Ministerio de Salud de la Nación, 27/12/2024. Ubicación por centroide de localidad (georef, datos.gob.ar).",
  detalle:[...PROV_DET],
  locs: locs.map(l=>[l.loc,l.prov,l.ll[0],l.ll[1],l.f,l.i,l.n]),
  est,
  nombresOficiales
};
const path='D:/Mi unidad/Claude/eyg-core/direccion/universo-salud.json';
fs.writeFileSync(path, JSON.stringify(OUT));
const kb=Math.round(fs.statSync(path).size/1024);
console.log('localidades (todo el país):',locs.length);
console.log('establecimientos con detalle (SF+ER+CBA):',est.length);
console.log('clientes con nombre oficial corregido:',Object.keys(nombresOficiales).length);
console.log('archivo:',kb,'KB →',path);
console.log('\nejemplo de nombres corregidos:');
Object.values(nombresOficiales).slice(0,8).forEach(n=>console.log('  '+n));
