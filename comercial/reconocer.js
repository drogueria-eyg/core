/* ============================================================
   RECONOCER — ¿el renglón que pide el hospital es el mismo
   medicamento que este producto de EyG, aunque se llame distinto?
   ============================================================
   Se compara QUÉ ES cada cosa, no cómo se escribe. De cada texto se
   saca una ficha: droga(s), dosis (en una unidad común) y forma.

   VERDE («igual») sólo si es un EQUIVALENTE FARMACÉUTICO: mismas drogas,
   misma dosis y misma forma. Es el criterio de la Ley 25.649 (sustituir
   por otro con los mismos principios activos, concentración y forma
   farmacéutica) y de la FDA (21 CFR 320.1). Decidido con Diego el
   5/11/2026, con estas fuentes:
     · comprimido = comprimido recubierto = tableta = gragea: la misma
       forma básica para la EDQM;
     · comprimido ≠ cápsula: la FDA las trata como «alternativas», no
       equivalentes, aunque tengan la misma droga y dosis;
     · liberación prolongada, sublingual, efervescente, dispersable,
       masticable o gastrorresistente son OTRA forma.
   Todo lo demás es «revisar», con el motivo a la vista: la herramienta
   no adivina. Una droga reconocida por la marca o por un nombre mal
   escrito también va a revisar (pedido de Diego: la marca pedida se
   ofrece como equivalente, pero en amarillo).

   No guarda datos de AlfaBeta: el diccionario de drogas se le pasa
   armado desde Odoo en el momento (el repo es público).
   Funciona igual en el navegador y en node (para medirlo contra el
   historial de lo que cotizaron las comerciales).
   ============================================================ */
(function(raiz){
"use strict";

/* ---------- texto ---------- */
function norm(s){
  return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()
    .replace(/¢/g," ");                               // «S¢DICA»: Ó mal codificada
}
function tokens(s){ return norm(s).replace(/([a-z])(\d)/g,"$1 $2").replace(/(\d)([a-z]{3,})/g,"$1 $2").replace(/[^a-z0-9]+/g," ").trim().split(/\s+/).filter(Boolean); }
/* «atorvastatina» / «atorvastatin», «budesonida» / «budesonide»: AlfaBeta mezcla
   la forma inglesa y la castellana. Se compara sin la vocal final. */
function canon(w){ return (w.length>=7 && /[ae]$/.test(w) && !SAL.has(w) && !MINERAL.has(w)) ? w.slice(0,-1) : w; }

/* Palabras de sal: no cambian la droga («gentamicina sulfato» = gentamicina)…
   salvo en las sales minerales, donde el anión y el catión SON la droga
   (cloruro de potasio ≠ cloruro de sodio). */
const SAL = new Set(("sulfato clorhidrato hidrocloruro diclorhidrato bromhidrato fosfato sodico sodica potasico potasica calcico calcica "+
  "magnesico magnesica maleato mesilato besilato tartrato citrato acetato succinato fumarato hidrobromuro bromuro cloruro "+
  "nitrato lactato gluconato monohidrato dihidrato trihidrato anhidro hemihidrato pentahidrato sal disodica disodico "+
  "dipropionato propionato valerato butirato decanoato enantato palmitato estearato besilato tosilato carbonato "+
  "hidroxido oxido yoduro butilbr metilbr metansulfonato hiclato pamoato furoato acetonido hemisuccinato bitartrato teoclato dimesilato estolato etilsuccinato trometamol dipotasico sodio potasio calcio magnesio zinc hierro ferroso ferrico n butil butilbromuro metilbromuro de del y").split(" "));
const MINERAL = new Set(["cloruro","sodio","potasio","calcio","magnesio","bicarbonato","carbonato","sulfato","gluconato","fosfato","citrato","lactato","zinc","hierro","ferroso","yoduro","oxido","hidroxido"]);
/* Nombres de uso hospitalario que no son el nombre de la droga. */
const SINONIMOS = [
  [/ fisiologic[oa] /, ["cloruro","sodio"]],
  [/ dextrosa /, ["glucosa"]],
  [/ glucosad/, ["glucosa"]],
  [/ adrenalina /, ["epinefrina"]], [/ noradrenalina /, ["norepinefrina"]]
];
/* Monodrogas de AlfaBeta que no son drogas (insumos): no se usan para comparar. */
const NO_DROGA = /accesorio|dispositivo|aplic|aposito|venda|gasa|jeringa|aguja|sonda|cateter|guante|algodon|preservativo|panal|\btest\b|tiras|reactiv|lanceta|alimento|leche|formula|suplemento|cosmet|protector solar|repelente/;
/* Palabras que en AlfaBeta encabezan nombres comerciales pero son genéricas: no son marcas. */
const NO_MARCA = new Set(("aguja agujas jeringa jeringas guante guantes sonda sondas cateter gasa gasas algodon alcohol solucion "+
  "agua crema gel jabon shampoo locion leche polvo aceite vaselina tiras test bolsa equipo kit set apositos aposito venda vendas "+
  "barbijo cofia camisolin compresas parche parches suero").split(" "));
const VACIAS = new Set(("de del la el los las y con sin x para por en al mg mcg ml g gr ui comp caps amp tab sol iny "+
  "acido vitamina vit complejo asoc asociaciones extracto solucion agua").split(" "));

/* ---------- diccionario de drogas (se arma con las monodrogas de Odoo) ----------
   dic = { comps: Map(clave → {nombre, toks}), porToken: Map(token → [clave]),
           drogas: Map(idOdoo → [clave,...]), marcas: Map(token → Set(idOdoo)) } */
function componente(nombre){
  // «potasio,cloruro» y «cloruro de potasio» → mismas palabras
  let t = tokens(String(nombre).replace(/,/g," ")).filter(w=>w!=="de"&&w!=="del");
  if(!t.length) return null;
  const nucleo = t.every(w=>SAL.has(w)||MINERAL.has(w)) ? t : t.filter(w=>!SAL.has(w));
  if(!nucleo.length || nucleo.every(w=>VACIAS.has(w)||w.length<3)) return null;
  const nc = [...new Set(nucleo.map(canon))];
  return { clave:nc.slice().sort().join(" "), toks:nc, sal:t.filter(w=>SAL.has(w)&&!nucleo.includes(w)) };
}
/* AlfaBeta abrevia: «acetilsalicílico,ác.», «hioscina,n-butilbr.». Se expanden las
   conocidas; una abreviatura que no se puede expandir deja la droga sin comparar. */
const ABREV = { "ac":"acido", "n butilbr":"butilbromuro", "butilbr":"butilbromuro", "metilbrom":"metilbromuro", "metilbr":"metilbromuro",
  "vit":"vitamina", "clorh":"clorhidrato", "clorhid":"clorhidrato", "sod":"sodico", "pot":"potasico", "cloramf":"cloranfenicol",
  "acetilsalicil":"acetilsalicilico", "fenobarb":"fenobarbital", "bicarb":"bicarbonato", "gentamic":"gentamicina", "ins":"insulina",
  "dipropion":"dipropionato", "sulf":"sulfato", "hidrocl":"clorhidrato", "complej":"complejo" };
function expandir(desc){
  let s = norm(desc).replace(/-/g," ");
  s = s.replace(/([a-z]+(?:\s[a-z]+)?)\.(?=[\s,+]|$)/g,(m,w)=>{
    if(ABREV[w]!=null) return ABREV[w];
    const ult = w.split(" ").pop();
    if(ABREV[ult]!=null) return w.slice(0,-ult.length)+ABREV[ult];
    return m;                                    // sin expandir: queda el punto y se descarta abajo
  });
  return s;
}
function armarDiccionario(monodrogas, productosConDroga){
  const dic = { comps:new Map(), porToken:new Map(), drogas:new Map(), marcas:new Map(), vocab:new Set() };
  for(const [id, desc0] of monodrogas){
    const desc = expandir(desc0);
    const partes = String(desc||"").split("+").map(s=>s.trim()).filter(Boolean);
    if(partes.some(p=>/\basoc\b|\.\s*$|\.\s|^vit\b|\bvitamina$/i.test(p))){ dic.drogas.set(id,null); continue; } // sin expandir o «+ asociaciones»: no se comparan
    if(NO_DROGA.test(desc)){ dic.drogas.set(id,null); continue; }
    const cs = partes.map(componente);
    if(cs.some(c=>!c)){ dic.drogas.set(id,null); continue; }
    dic.drogas.set(id, [...new Set(cs.map(c=>c.clave))].sort());
    for(const c of cs){
      if(!dic.comps.has(c.clave)) dic.comps.set(c.clave, c);
      for(const w of c.toks){ dic.vocab.add(w); const a=dic.porToken.get(w)||[]; if(!a.includes(c.clave)) a.push(c.clave); dic.porToken.set(w,a); }
    }
  }
  // marcas: la primera palabra del nombre comercial de AlfaBeta → su droga
  for(const [nombre, id] of (productosConDroga||[])){
    const marca = tokens(String(nombre).split(/\s+-\s+|\(/)[0])[0];
    if(!marca || marca.length<4 || dic.vocab.has(canon(marca)) || VACIAS.has(marca) || NO_MARCA.has(marca)) continue;
    const s = dic.marcas.get(marca)||new Set(); s.add(id); dic.marcas.set(marca,s);
  }
  return dic;
}

/* Distancia de edición acotada (para «RISPERDIDONA», «DOXAZOCINA»). */
function lev(a,b,max){
  if(Math.abs(a.length-b.length)>max) return max+1;
  let prev = Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const cur=[i]; let mejor=i;
    for(let j=1;j<=b.length;j++){ cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1)); if(cur[j]<mejor) mejor=cur[j]; }
    if(mejor>max) return max+1;
    prev=cur;
  }
  return prev[b.length];
}

/* Drogas de un texto libre: devuelve {drogas:[clave], via:"nombre"|"aprox"|"marca", marcaIds} */
function drogasDeTexto(texto, dic){
  // «SIN EPINEFRINA», «s/e», «s/ epinefrina»: lo que dice que NO lleva no es parte de la droga
  const limpio = norm(texto).replace(/\bs\s*\/\s*e\b/g," ").replace(/\b(sin|s\s*\/)\s*[a-z]+/g," ");
  const crudos = tokens(limpio);
  let t = crudos.map(canon);
  // «LOSART N» / «VALSART N»: la letra acentuada se perdió → probar pegando
  for(let i=0;i<t.length-1;i++){
    if(t[i+1].length===1 && t[i].length>=4 && !dic.vocab.has(t[i])){
      const re = new RegExp("^"+t[i]+"."+t[i+1]+"$");
      const hit = [...dic.vocab].find(w=>re.test(w));
      if(hit){ t.splice(i,2,hit); }
    }
  }
  const T = new Set(t);
  const txt = " "+crudos.join(" ")+" ";
  for(const [re, ws] of SINONIMOS) if(re.test(txt)) ws.forEach(w=>T.add(canon(w)));
  let via = "nombre";
  const hallar = conj => {
    const out=[];
    for(const w of conj){
      for(const k of (dic.porToken.get(w)||[])){
        const c = dic.comps.get(k);
        if(c.toks.every(x=>conj.has(x)) && !out.includes(k)) out.push(k);
      }
    }
    // si una droga está contenida en otra encontrada («adrenalina» dentro de «noradrenalina» no pasa
    // porque se compara por palabras; pero «hioscina» dentro de «hioscina butilbromuro» sí): quedarse con la mayor
    return out.filter(k=>!out.some(o=>o!==k && dic.comps.get(k).toks.every(x=>dic.comps.get(o).toks.includes(x))));
  };
  let encontradas = hallar(T);
  if(!encontradas.length){
    // nombre mal escrito: una sola palabra del diccionario a distancia ≤1 (≤2 si es larga)
    const T2 = new Set(T);
    let cambio=false;
    for(const w of T){
      if(w.length<6 || dic.vocab.has(w) || VACIAS.has(w)) continue;
      const max = w.length>=9 ? 2 : 1;
      const cands = [...dic.vocab].filter(v=>v.length>=6 && lev(w,v,max)<=max);
      if(cands.length===1){ T2.add(cands[0]); cambio=true; }
    }
    if(cambio){ encontradas = hallar(T2); if(encontradas.length) via="aprox"; }
  }
  let marcaIds = null;
  if(!encontradas.length){
    // marca: la palabra coincide con la primera palabra de un nombre comercial y lleva a UNA droga
    for(const w of crudos){
      const ids = dic.marcas.get(w) || (w.endsWith("s") ? dic.marcas.get(w.slice(0,-1)) : null) || dic.marcas.get(w+"s");
      if(!ids) continue;
      const sets = [...new Set([...ids].map(id=>JSON.stringify(dic.drogas.get(id)||null)))];
      if(sets.length===1 && sets[0]!=="null"){ encontradas = JSON.parse(sets[0]); via="marca"; marcaIds=[...ids]; break; }
    }
  }
  return { drogas:[...new Set(encontradas)].sort(), via, marcaIds };
}

/* ---------- dosis ----------
   Masa en mg (mcg/1000, g×1000), UI aparte, % aparte, volumen en ml. */
function dosisDeTexto(texto){
  let s = norm(texto).replace(/(\d),(\d)/g,"$1.$2");
  s = s.replace(/\bgramos?\b/g,"g").replace(/\bmicrogramos?\b|\bµg\b|\bug\b|\bgammas?\b/g,"mcg")
       .replace(/\bmiligramos?\b/g,"mg").replace(/\bu\.?\s?i\.?(?=\W|$)/g,"ui").replace(/\bmillones\b/g,"mui");
  const masas=[], ui=[], pct=[], conc=[];
  let vol=null;
  /* «80 mg/ml» es una concentración; «80 mg/0,8 ml» o «1 g/2 ml» es lo que trae
     la unidad (la jeringa, la ampolla). Leerlo como concentración igualaba la
     enoxaparina 80 mg/0,8 ml con la de 60 mg/0,6 ml (medido 5/11/2026). */
  s = s.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ui)\s*\/\s*(\d+(?:\.\d+)?)?\s*ml\b/g,(m,v,u,por)=>{
    if(por && +por!==1){
      if(u==="ui") ui.push(+v); else masas.push(aMg(+v,u));
      if(vol==null) vol = +por;
    } else conc.push(r6(aMg(+v,u))+(u==="ui"?"ui":"")+"/ml");
    return " ";
  });
  // combinaciones «100/25 mg», «5/12.5 mg»
  s = s.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(mg|mcg|g)\b/g,(m,a,b,u)=>{ masas.push(aMg(+a,u), aMg(+b,u)); return " "; });
  s = s.replace(/(\d+(?:\.\d+)?)\s*(mcg|mg|gr|g|mui|ui|meq|%)(?![a-z])/g,(m,v,u)=>{
    v=+v;
    if(u==="%") pct.push(v);
    else if(u==="ui") ui.push(v);
    else if(u==="mui") ui.push(v*1e6);
    else if(u==="meq") ui.push("meq"+v);
    else masas.push(aMg(v,u));
    return " ";
  });
  const mv = s.match(/(?:x\s*)?(\d+(?:\.\d+)?)\s*(ml|cc|lts?|litros?)\b/);
  if(mv && vol==null) vol = /l/.test(mv[2]) && !/ml/.test(mv[2]) ? +mv[1]*1000 : +mv[1];
  return { masas:masas.map(r6), ui, pct, conc, vol };
}
function aMg(v,u){ return u==="mcg" ? v/1000 : (u==="g"||u==="gr") ? v*1000 : v; }
function r6(n){ return Math.round(n*1e6)/1e6; }

/* ---------- forma ---------- */
/* Variantes que cambian la forma. Detectar de más sólo manda a revisar;
   detectar de menos daría un verde falso — por eso la lista es amplia
   (medido 5/11/2026: «KETOROLAC SL» y «comp.rec.gastro» se colaban). */
const MODS = [
  ["liberación prolongada", /\b(lp|xr|sr|er|xl|mr|cr|retard|ocas|oros|zok|ud|depot|prolongada|prolong|prol|extendida|modificada|ap|liberacion|lib|cronos)\b/],
  ["sublingual", /\bsub\s?lingual(es)?\b|\bsubl\b|\bsl\b/],
  ["efervescente", /\beferv\w*\b/],
  ["dispersable", /\b(oro|buco)?dispersables?\b|\b(odt|dt|zydis|flas|flash)\b/],
  ["masticable", /\bmasticables?\b|\bmast\b/],
  ["gastrorresistente", /\bgastro\w*\b|\benteric\w*\b|\b(dr|ec)\b/],
  ["vaginal", /\bvaginal(es)?\b/]
];
function formaDeTexto(texto){
  let s = " "+norm(texto).replace(/\ba\s*\.\s*x\b/g," amp x ").replace(/f\s*[\/.]\s*a\b/g," fa ").replace(/[^a-z0-9%\/]+/g," ")+" ";
  const tiene = re => re.test(s);
  let base=null, envase=null, polvo=null;
  if(tiene(/\b(comp|comps|comprimidos?|tab|tabs|tabletas?|grag|grageas?|recubiertos?|ranurados?|birranurados?|divisibles?)\b/)) base="comprimido";
  if(tiene(/\b(cap|caps|capsulas?)\b/)) base = base ? "ambigua" : "cápsula";
  if(tiene(/\b(amp|amps|ampollas?|ampolletas?|iny|inyectables?|fa|vial|viales|jga|jer|jeringas?|prell|prellenadas?|liof|liofilizados?)\b|frasco\s+ampolla|fco\s+amp/)){
    base = base && base!=="inyectable" ? "ambigua" : "inyectable";
    envase = tiene(/\b(jga|jer|jeringas?|prell|prellenadas?)\b/) ? "jeringa prellenada"
           : tiene(/\b(fa|vial|viales)\b|frasco\s+ampolla|fco\s+amp/) ? "frasco ampolla"
           : tiene(/\b(amp|amps|ampollas?|ampolletas?)\b/) ? "ampolla" : null;
    // polvo y solución sólo cuentan si el texto lo dice: «Ceftriaxona 1 g ampollas» no dice nada
    polvo = tiene(/\b(liof|liofilizados?|polvo|pvo)\b|s\s?\/\s?sol|sin solvente/) ? true
          : tiene(/\b(sol|solucion|soluc)\b/) ? false : null;
  }
  // primero las que se confunden con otras: «gotas oftálmicas» es colirio, «aerosol HFA» es inhalador
  const otras = [["colirio",/\b(colirio|oftalmic[ao]s?|oft)\b/],["inhalador",/\binhal\w*|\bhfa\b|\binh\b|\bpuffs?\b/],
    ["jarabe",/\b(jbe|jarabe)\b/],["suspensión",/\b(susp|suspension)\b/],["gotas",/\b(gts|gotas|gotero)\b/],
    ["crema",/\bcrema\b|\bcr\s+x\b/],["ungüento",/\b(ung|unguento|pomada)\b/],["gel",/\bgel\b/],["jalea",/\bjalea\b/],
    ["loción",/\blocion\b/],["spray",/\b(spray|aerosol|aer)\b/],["supositorio",/\b(sup|supositorios?)\b/],
    ["óvulo",/\bovulos?\b/],["parche",/\bparches?\b/],["sobre",/\bsobres?\b/],["enema",/\benemas?\b/]];
  if(!base) for(const [n,re] of otras) if(tiene(re)){ base=n; break; }
  if(!base && tiene(/\b(sol|solucion)\b/)) base="solución";
  const mods = (base==="comprimido"||base==="cápsula"||base==="ambigua") ? MODS.filter(([,re])=>re.test(s)).map(([n])=>n) : [];
  return { base, mods, envase, polvo };
}

/* ---------- sal y marca nombradas ----------
   Otra sal es otro producto para la FDA («alternativa», no equivalente):
   diclofenac sódico ≠ potásico, betametasona valerato ≠ dipropionato. */
const SALES = [["sódica",/\bsodic[oa]s?\b/],["potásica",/\bpotasic[oa]s?\b/],["cálcica",/\bcalcic[oa]s?\b/],["magnésica",/\bmagnesic[oa]s?\b/],
  ["clorhidrato",/\bclorhidrato\b|\bhcl\b/],["bromhidrato",/\bbromhidrato\b/],["sulfato",/\bsulfato\b/],["maleato",/\bmaleato\b/],
  ["mesilato",/\bmesilato\b/],["besilato",/\bbesilato\b/],["tartrato",/\btartrato\b/],["succinato",/\bsuccinato\b/],["fumarato",/\bfumarato\b/],
  ["valerato",/\bvalerato\b/],["dipropionato",/\bdipropionato\b/],["propionato",/(^|[^i])\bpropionato\b/],["furoato",/\bfuroato\b/],
  ["acetónido",/\bacetonido\b/],["butilbromuro",/\bbutil\s?bromuro\b|\bbutilbr\b/],["metilbromuro",/\bmetil\s?bromuro\b/],["hiclato",/\bhiclato\b/]];
// las que se dan por sobreentendidas cuando el pedido no nombra ninguna
const SAL_HABITUAL = new Set(["sódica","clorhidrato","sulfato","butilbromuro"]);
function salesDeTexto(texto, drogas){
  const s = " "+tokens(norm(texto).replace(/-/g," ")).join(" ")+" ";
  const dentro = new Set((drogas||[]).join(" ").split(/\s+/));     // en «sulfato de magnesio» el sulfato ES la droga
  return SALES.filter(([n,re])=>re.test(s) && !dentro.has(norm(n).replace(/a$/,"o")) && !dentro.has(norm(n))).map(([n])=>n);
}
const NO_ES_MARCA = /^(comp\w*|caps\w*|amp\w*|frasco|soluc\w*|simple|forte|plus|duo|retard|unid\w*|hospitalari\w*|inyec\w*|jarabe|gotas|crema|tipo|suspension|tabletas?|grageas?|sobres?|polvo|liof\w*|sachet|envase|flexible|pote|pomo|gotero|topic\w*|oral|antitusiv\w*|expectorante|analgesic\w*|antibiotic\w*|pediatric\w*|adulto|infantil|esteril|descartable)$/;
function marcasDeTexto(texto, dic){
  dic._esMarca = dic._esMarca || new Map();          // la cuenta contra todo el vocabulario se hace una vez por palabra
  return [...new Set(tokens(texto).filter(w=>{
    if(w.length<5 || !dic.marcas.has(w) || dic.vocab.has(canon(w)) || NO_ES_MARCA.test(w) || SAL.has(w) || MINERAL.has(w)) return false;
    if(dic._esMarca.has(w)) return dic._esMarca.get(w);
    // un nombre de droga mal escrito («FURSEMIDA», «DIAZEPAN») no es una marca
    let ok = true;
    for(const v of dic.vocab) if(v.length>=5 && lev(canon(w),v,2)<=2){ ok=false; break; }
    dic._esMarca.set(w, ok);
    return ok;
  }))];
}

/* Palabras que se entienden sin ser droga: forma, unidad, vía, relleno.
   Lo que el pedido dice y no está acá ni es droga ni marca conocida queda
   como «rara» y manda a revisar: «ZOLPIDEM 10 MG (SOMIT)» nombra una marca
   que Odoo no tiene, «HIOSCINA COMPUESTA» es una combinación. Medido en el
   pedido 84928 de Portada (5/11/2026): sin esta regla salía en verde. */
const CONOCIDAS = new Set(("comp comps comprimido comprimidos tab tabs tableta tabletas rec recub recubierto recubiertos recubierta recubiertas "+
  "ranurado ranurados ran birranurado birranurados divisible divisibles grag gragea grageas cap caps capsula capsulas blanda blandas dura duras "+
  "amp amps ampolla ampollas ampolleta ampolletas iny inyec inyectable inyectables fa vial viales jga jer jeringa jeringas prell prellenada "+
  "prellenadas prellena liof liofilizado liofilizada polvo pvo sol soluc solucion jbe jarabe susp suspension gts gotas gotero crema ung unguento "+
  "pomada gel jalea locion spray aerosol aer inhal inhalador inhalatoria inhalatorio hfa sup supositorio supositorios ovulo ovulos parche parches "+
  "colirio oftalmica oftalmicas oftalmico oft sobre sobres enema frasco fco fsco flexible sachet envase envases pote pomo bolsa "+
  "lp xr sr er xl mr cr retard ocas oros zok ud depot prolongada prol extendida modificada liberacion lib controlada sublingual subl sl "+
  "eferv efervescente efervescentes dispersable orodispersable bucodispersable odt masticable mast gastro gastrorresistente enterico vaginal "+
  "mg mcg gr gramo gramos ml cc ui mui meq lts litro litros dosis puff puffs oral iv im ev sc vo topica topico uso via adulto adultos "+
  "pediatrico pediatrica infantil hosp hospitalario hospitalaria unid unidad unidades por del los las con sin para tipo blister caja cajas "+
  "generico generica acepta acepto alternativa alternativas cantidad vencimiento largo vto aprox simple solo sola cada contiene "+
  "fisiologica fisiologico isotonica hipertonica hipertonico hipotonica glucosada glucosado esteril apirogena").split(" "));
function rarasDeTexto(texto, dic, drogas, marcas){
  const deDroga = new Set((drogas||[]).join(" ").split(/\s+/));
  return [...new Set(tokens(norm(texto).replace(/\bs\s*\/\s*e\b/g," ").replace(/\b(sin|s\s*\/)\s*[a-z]+/g," ")))].filter(w=>{
    if(w.length<=2 || /\d/.test(w)) return false;
    const c = canon(w);
    if(CONOCIDAS.has(w) || VACIAS.has(w) || SAL.has(w) || MINERAL.has(w) || NO_MARCA.has(w)) return false;
    if(deDroga.has(c) || dic.vocab.has(c)) return false;
    if((marcas||[]).includes(w)) return false;
    return true;
  });
}

/* ---------- ficha ---------- */
function ficha(texto, dic, extra){
  const d = drogasDeTexto(texto, dic);
  // marcas y palabras raras sólo importan del lado del pedido (extra = es un producto de EyG)
  const f = { texto:String(texto||""), drogas:d.drogas, via:d.via, dosis:dosisDeTexto(texto), forma:formaDeTexto(texto),
    marcas: extra ? [] : marcasDeTexto(texto, dic) };
  // producto de EyG: si Odoo tiene la monodroga cargada, manda esa (es el dato curado)
  if(extra && extra.monodrogaId!=null && dic.drogas.has(extra.monodrogaId)){
    const ds = dic.drogas.get(extra.monodrogaId);
    if(ds){ f.drogas = ds; f.via = "odoo"; } else { f.via = "odoo-abreviada"; }
  }
  // la forma también puede venir de la categoría de Odoo («HOSP. AMPOLLAS»)
  if(extra && extra.categoria && !f.forma.base){ const fc = formaDeTexto(extra.categoria); if(fc.base) f.forma = Object.assign(fc, {deCategoria:true}); }
  f.sales = salesDeTexto(texto, f.drogas);
  f.raras = extra ? [] : rarasDeTexto(texto, dic, f.drogas, f.marcas);
  return f;
}

const PARECIDAS = new Set(["gotas|solución","colirio|gotas","crema|gel","crema|ungüento","spray|solución","inhalador|spray","jarabe|solución","gotas|suspensión"]);

/* ---------- comparar ----------
   nivel: "igual" (verde) · "revisar" (amarillo, con motivos) · "distinto" */
function comparar(p, e){
  const motivos=[];
  const igualesSet=(a,b)=>a.length===b.length && a.every((x,i)=>x===b[i]);
  if(!p.drogas.length) return {nivel:"distinto", motivos:["no reconozco la droga del pedido"]};
  if(!e.drogas.length) return {nivel:"distinto", motivos:["el producto no tiene la droga cargada"]};
  if(!igualesSet(p.drogas,e.drogas)){
    const comun = p.drogas.filter(x=>e.drogas.includes(x));
    return {nivel:"distinto", motivos:[comun.length ? "otra composición ("+e.drogas.join(" + ")+")" : "otra droga"]};
  }
  if(p.raras && p.raras.length && p.via!=="aprox"){
    const nom = norm(e.texto);
    const sinExplicar = p.raras.filter(w=>!new RegExp("\\b"+w+"\\b").test(nom));   // si el producto la tiene en el nombre, es su marca
    if(sinExplicar.length) motivos.push("el pedido dice «"+sinExplicar.join(" ").toUpperCase()+"» y no sé qué es");
  }
  if(p.via==="marca") motivos.push("el pedido nombra una marca: es el equivalente");
  else if(p.marcas && p.marcas.length){
    const nom = norm(e.texto);
    if(!p.marcas.some(m=>new RegExp("\\b"+m+"\\b").test(nom))) motivos.push("el pedido nombra la marca "+p.marcas.join(", ").toUpperCase()+": este es el equivalente");
  }
  // sal
  const ps = p.sales||[], es = e.sales||[];
  if(ps.length && es.length && !ps.some(x=>es.includes(x))) motivos.push("otra sal ("+es.join(", ")+" en vez de "+ps.join(", ")+")");
  else if(!ps.length && es.some(x=>!SAL_HABITUAL.has(x))) motivos.push("es "+es.filter(x=>!SAL_HABITUAL.has(x)).join(", ")+"; el pedido no dice la sal");
  if(p.via==="aprox") motivos.push("el nombre del pedido está mal escrito");
  if(e.via==="aprox"||e.via==="marca") motivos.push("droga del producto deducida del nombre");
  // dosis
  const pd=p.dosis, ed=e.dosis;
  const mismas=(a,b)=>{ const x=[...a].sort((m,n)=>m-n), y=[...b].sort((m,n)=>m-n); return x.length===y.length && x.every((v,i)=>Math.abs(v-y[i])<=1e-6*Math.max(1,v)); };
  const pTiene = pd.masas.length||pd.ui.length||pd.pct.length||pd.conc.length;
  const eTiene = ed.masas.length||ed.ui.length||ed.pct.length||ed.conc.length;
  if(!pTiene) motivos.push("el pedido no dice la dosis");
  else if(!eTiene) motivos.push("el producto no dice la dosis en el nombre");
  else {
    let ok = true;
    // «0,2 % x 100 ml» es 200 mg: el % de una solución es gramos cada 100 ml
    const masaDe = d => d.masas.length ? d.masas : (d.pct.length===1 && d.vol ? [r6(d.pct[0]*10*d.vol)] : []);
    if(pd.masas.length && !ed.masas.length && ed.pct.length) ok = ok && mismas(pd.masas, masaDe(ed));
    else if(!pd.masas.length && pd.pct.length && ed.masas.length && !ed.pct.length) ok = ok && mismas(masaDe(pd), ed.masas);
    else {
      if(pd.masas.length) ok = ok && mismas(pd.masas, ed.masas);
      if(pd.pct.length) ok = ok && mismas(pd.pct, ed.pct);
    }
    if(pd.ui.length) ok = ok && JSON.stringify(pd.ui.map(String).sort())===JSON.stringify(ed.ui.map(String).sort());
    if(pd.conc.length){
      let ec = ed.conc.slice();
      if(!ec.length && ed.masas.length===1 && ed.vol) ec=[r6(ed.masas[0]/ed.vol)+"/ml"];
      if(!(ec.length && pd.conc.every(c=>ec.includes(c)))){
        // «80 mg/ml» en el pedido y «80 mg x 2 ml» en el producto: casi siempre quisieron decir la ampolla
        if(pd.conc.length===1 && ed.masas.length===1 && parseFloat(pd.conc[0])===ed.masas[0]) motivos.push("el pedido dice "+pd.conc[0].replace("/ml"," mg/ml")+" y el producto trae "+ed.masas[0]+" mg en "+ed.vol+" ml");
        else ok=false;
      }
    }
    if(!pd.masas.length && !pd.ui.length && !pd.pct.length && !pd.conc.length) ok=false;
    // «ampicilina 1000 mg + sulbactam 500 mg» contra «1,5 g»: la misma dosis dicha como total
    if(!ok && pd.masas.length>1 && ed.masas.length===1 && Math.abs(pd.masas.reduce((a,b)=>a+b,0)-ed.masas[0])<1e-6){
      ok = true; motivos.push("el producto dice la dosis total ("+ed.masas[0]+" mg)");
    } else if(!ok && ed.masas.length>1 && pd.masas.length===1 && Math.abs(ed.masas.reduce((a,b)=>a+b,0)-pd.masas[0])<1e-6){
      ok = true; motivos.push("el pedido dice la dosis total ("+pd.masas[0]+" mg)");
    }
    if(!ok) return {nivel:"distinto", motivos:["otra dosis"]};
  }
  // forma
  const pf=p.forma, ef=e.forma;
  if(!pf.base) motivos.push("el pedido no dice la forma");
  else if(!ef.base) motivos.push("el producto no dice la forma en el nombre");
  else if(pf.base==="ambigua"||ef.base==="ambigua") motivos.push("forma ambigua");
  else if(pf.base!==ef.base){
    // parecidas pero no iguales: una persona tiene que mirarlas
    const par = [pf.base,ef.base].sort().join("|");
    if(PARECIDAS.has(par)) motivos.push(ef.base+" en vez de "+pf.base);
    else return {nivel:"distinto", motivos:["otra forma ("+ef.base+" en vez de "+pf.base+")"]};
  }
  else {
    const pm=pf.mods.join(","), em=ef.mods.join(",");
    if(pm!==em) motivos.push(em ? "es "+ef.mods.join(", ") : "el pedido pide "+pf.mods.join(", "));
    if(pf.base==="inyectable"){
      // ampolla y frasco ampolla son el envase, no la forma (EDQM): se aceptan; la jeringa prellenada no
      const jer = e => e==="jeringa prellenada";
      if(pf.envase && ef.envase && jer(pf.envase)!==jer(ef.envase)) motivos.push(ef.envase+" en vez de "+pf.envase);
      if(pf.polvo!=null && ef.polvo!=null && pf.polvo!==ef.polvo) motivos.push(ef.polvo ? "es polvo para reconstituir" : "es solución lista, el pedido pide polvo");
    }
  }
  // volumen: en líquidos e inyectables, otro volumen es otra presentación
  if(pd.vol && ed.vol && Math.abs(pd.vol-ed.vol)>1e-6 && pf.base && !["comprimido","cápsula"].includes(pf.base))
    motivos.push("otro volumen ("+ed.vol+" ml en vez de "+pd.vol+" ml)");
  return { nivel: motivos.length ? "revisar" : "igual", motivos };
}

/* ============================================================
   INSUMOS (agujas, jeringas, catéteres, sondas, guantes…)
   No tienen droga: los definen unos pocos datos. Se reconoce la FAMILIA
   y se leen sus datos; verde sólo si todo lo que pide el hospital está en
   el producto y coincide. Agregado el 5/11/2026 con el historial de
   Bionexo (858 pedidos de insumos con lo que eligió cada comercial).
   ============================================================ */
// Notación argentina de agujas «40/12» = 40 mm de largo y 1,2 mm de diámetro (18 G)
const DIAM_A_G = {16:16, 14:17, 12:18, 11:19, 10:19, 9:20, 8:21, 7:22, 6:23, 55:24, 5:25, 45:26, 4:27, 3:30};
const PULG_A_MM = {"1/2":13, "5/8":16, "3/4":19, "1":25, "1 1/4":32, "1 1/2":38, "2":50, "3":75};
const largoStd = mm => mm>=36 && mm<=41 ? 38 : mm;          // 1 ½" se rotula 38 ó 40 mm

// familia: [nombre, regex sobre el texto normalizado]. Lo más específico primero.
const FAMILIAS = [
  ["descartador", /\bdescartador|cortopunz|colector .*(agujas?|cortop)/],
  ["butterfly", /\bbutterfly\b|\bmariposa\b|\bscalp\b/],
  ["cateter central", /cateter.*(central|lumen|cvc|hemodialisis|dialisis)|\b(doble|triple) lumen\b/],
  ["cateter iv", /\babbocath?\b|\bjelco\b|\babocath\b|cateter.*(intravenoso|periferico|\biv\b|\babb\b)|\bbranula\b|cateter n\D{0,3}\d{2}\b/],
  // jeringa, equipo y llave antes que aguja: «JERINGA 5 ML S/AGUJA» es una jeringa
  ["jeringa", /\bjeringas?\b/],
  ["equipo suero", /\bequipo\b.*\b(suero|perfusion|venoclisis|macrogotero|microgotero|infusion|transfusion|v\s?\d+)\b|\b(macro|micro)gotero\b/],
  ["llave 3 vias", /\bllaves?\b.*\b3\s*v/],
  ["aguja", /\bagujas?\b/],
  ["sonda foley", /\bfoley\b/],
  ["sonda k", /\bsonda\b.*\bk\s?-?\s?\d|^k\s?-?\s?\d+\b/],
  ["sonda", /\bsonda\b/],
  ["guantes", /\bguantes?\b/],
  ["venda", /\bvendas?\b/],
  ["cinta", /\bcinta\b|\btela adhesiva\b|\bmicropore\b|\btranspore\b/],
  ["alcohol", /\balcohol\b/],
  ["vaselina", /\bvaselina\b/],
  ["agua oxigenada", /\bagua oxigenada\b/],
  ["barbijo", /\bbarbijos?\b|\btapabocas\b/],
  ["especulo", /\bespeculos?\b/],
  ["bajalengua", /\bbajalenguas?\b/],
  ["bisturi", /\bbisturi|\bhojas? de bisturi/],
  ["electrodo", /\belectrodos?\b/],
  ["gasa", /\bgasas?\b/],
  ["algodon", /\balgodon\b/],
  ["cofia", /\bcofias?\b/],
  ["aerocamara", /\baerocamaras?\b/],
  ["mascara", /\bmascaras?\b/]
];
function familiaDe(s){ for(const [n,re] of FAMILIAS) if(re.test(s)) return n; return null; }

function datosInsumo(texto){
  let s = " "+norm(texto).replace(/(\d),(\d)/g,"$1.$2").replace(/[º°]/g," ").replace(/["'`´]/g," ").replace(/\s+/g," ")+" ";
  s = s.replace(/\bx\s?11\/2\b/g,"x 1 1/2");                 // «21 G X 11/2» es 1 ½ mal tipeado
  const d = {};
  const num = re => { const m = s.match(re); return m ? m : null; };
  // calibre G (14 a 30), sin confundir con gramos
  let m = num(/\b(1[4-9]|2[0-9]|30)\s?g\b(?!r)/); if(m) d.G = +m[1];
  // aguja argentina 40/12, 25x8, (38-8)
  m = num(/\b(1[3-9]|[2-5]\d|75)\s?[\/x-]\s?(\d{1,2})\b(?!\s?(cm|mm|ml|cc))/);
  if(m && DIAM_A_G[+m[2]]){ d.largo = d.largo || largoStd(+m[1]); d.G = d.G || DIAM_A_G[+m[2]]; d.Gnot = DIAM_A_G[+m[2]]; }
  // largo en pulgadas «x 1 1/2», «1 1/2»
  // (?<![\d\/]): el «2» de «1/2» no es un largo de 2 pulgadas
  m = num(/(?<![\d\/])\bx?\s?(1 1\/[24]|1\/2|5\/8|3\/4|[123])\s?(pulg|"|\b)(?!\s?(cm|mm|ml|cc|l|lt|g|gr|mts?|v|vias|%|\/))/);
  if(m && d.G && !d.largo) d.largo = largoStd(PULG_A_MM[m[1]]);
  m = num(/\b(\d{2})\s?mm\b/); if(m && !d.largo && d.G) d.largo = largoStd(+m[1]);
  m = num(/\b(\d{1,2})\s?(fr|f|ch)\b/); if(m) d.Fr = +m[1];
  m = num(/\b(n|nro|no|num|numero|n\.)\s?\.?\s?(\d{1,2}(?:\.5)?)(\s1\/2)?\b/); if(m) d.num = +m[2] + (m[3]?0.5:0);
  m = num(/\bk\s?-?\s?(\d{1,3})\s?(p\b)?/); if(m) d.K = m[1]+(m[2]?"P":"");
  m = num(/\b(\d+(?:\.\d+)?)\s?(ml|cc)\b/); if(m) d.ml = +m[1];
  m = num(/\b(\d+(?:\.\d+)?)\s?(l|lt|lts|litros?)\b/); if(m) d.ml = +m[1]*1000;
  m = num(/\b(\d+(?:\.\d+)?)\s?cm\b/); if(m) d.cm = +m[1];
  m = num(/\bx\s?(\d+(?:\.\d+)?)\s?(m|mt|mts|mtr|mtrs|metros?)\b/); if(m) d.metros = +m[1];
  m = num(/\b(\d+(?:\.\d+)?)\s?(gr|g|grs|gramos)\b/); if(m && !d.G) d.gramos = +m[1];
  m = num(/\b(\d+(?:\.\d+)?)\s?kg\b/); if(m) d.gramos = +m[1]*1000;
  m = num(/\b(\d{1,3})(?:\s?\/\s?\d{1,3})?\s?%/); if(m) d.pct = +m[1];
  m = num(/\b(\d{1,2})\s?vol(umenes)?\b/); if(m) d.vol = +m[1];
  m = num(/\b(\d)\s?v(ias)?\b/); if(m) d.vias = +m[1];
  m = num(/\b(simple|mono|uni|doble|bi|triple|tri|[123])\s?lumen/); if(m) d.lumen = ({simple:1,mono:1,uni:1,doble:2,bi:2,triple:3,tri:3})[m[1]] || +m[1];
  m = num(/\btalle\s?(xxl|xl|xs|s|m|l)\b/) || num(/\b(xxl|xl|xs)\b/) || num(/\b(s|m|l)\b(?!\s?(\/|ml|cm|mm))/); if(m) d.talle = m[1];
  m = num(/\b(\d)\s?\/\s?0\b|\b(\d)-0\b/); if(m) d.calibre = (m[1]||m[2])+"/0";
  // palabras que distinguen
  const hay = re => re.test(s);
  if(hay(/\blatex\b/) && !hay(/\b(sin|libre de|s\/)\s?latex\b/)) d.material = "látex";
  if(hay(/\bnitrilo\b/)) d.material = "nitrilo";
  if(hay(/\bvinilo\b/)) d.material = "vinilo";
  if(hay(/\bsilicona\b/)) d.material = "silicona";
  if(hay(/\b(sintetico|sin latex|libre de latex|s\/latex)\b/)) d.material = d.material==="nitrilo" ? "nitrilo" : "sin látex";
  if(hay(/\b(esteril|esteriles|cirugia|quirurgico)\b/) && !hay(/\bno esteril/)) d.esteril = true;
  if(hay(/\b(examen|exam|procedimiento|no esteril)\b/)) d.esteril = false;
  if(hay(/\bsin polvo|s\/polvo|libre de polvo\b/)) d.polvo = false;
  if(hay(/\b(c\/|con)\s?aguja|\bc\/a\b/)) d.aguja = true;
  if(hay(/\b(s\/|sin)\s?aguja|\bs\/a\b/)) d.aguja = false;
  if(hay(/\b(pediatric[oa]s?|ped|infantil|neonatal|neo)\b/)) d.edad = "pediátrico";
  else if(hay(/\badult[oa]s?\b/)) d.edad = "adulto";
  const tipos = [["yeso",/\b(yeso|enyesada|yesada)\b/],["cambric",/\bcambric\b/],["ovata",/\b(ovata|algodon laminado)\b/],["elástica",/\belastica\b/],
    ["autoadherente",/\bautoadherente|cohesiva\b/],["tubular",/\btubular\b/],["micropore",/\b(micropore|hipoalergenica|hipoaler|papel)\b/],
    ["óxido de zinc",/\b(oxido de zinc|tela adhesiva|zinc)\b/],["transpore",/\btranspore\b/],["gel",/\bgel\b/],["líquido",/\bliquid[oa]\b/],
    ["sólida",/\bsolid[oa]\b/],["tuberculina",/\btuberculina\b/],["insulina",/\binsulina\b/],["luer lock",/\bluer\s?lock\b/],
    ["triple capa",/\btriple\s?capa|tricapa\b/],["n95",/\b(k?n\s?95|ffp2)\b/],["macrogotero",/\bmacro\s?gotero\b/],["microgotero",/\bmicro\s?gotero\b/],
    ["reservorio",/\breservorio\b/],["nebulización",/\bnebuliz/],["nasogástrica",/\bnaso\s?gastrica|levin\b/],["aspiración",/\baspiracion|\basp\b/],
    ["nelaton",/\bnelaton\b/],["prolongador",/\bprolongador/],["trozada",/\btrozad[oa]\b/],["hidrófilo",/\bhidrofilo\b/],
    ["espinal",/\b(espinal|raquidea|quincke)\b/],["epidural",/\b(epidural|tuohy|peridural)\b/],["mascara",/\bmascara\b/]];
  const t = tipos.filter(([,re])=>hay(re)).map(([n])=>n);
  if(t.length) d.tipos = t;
  return d;
}

/* Lo que define a cada familia: si el pedido no lo dice, hay que mirarlo;
   si lo dice y el producto no coincide, no es el mismo. */
const CLAVE_FAMILIA = {
  "aguja":["G","largo"], "butterfly":["G"], "cateter iv":["G"], "cateter central":["Fr","lumen"], "jeringa":["ml"],
  "sonda foley":["Fr|num"], "sonda k":["K"], "sonda":["Fr|num"], "guantes":["talle|num"], "venda":["cm"], "cinta":["cm"],
  "descartador":["ml"], "alcohol":["ml"], "vaselina":["ml|gramos"], "agua oxigenada":["ml"], "especulo":["talle"],
  "bisturi":["num"], "gasa":[], "algodon":["gramos"], "barbijo":[], "bajalengua":[], "llave 3 vias":[], "equipo suero":[],
  "electrodo":[], "cofia":[], "aerocamara":[], "mascara":[]
};
/* Datos que cambian el producto aunque el pedido no los mencione: si el
   producto los trae y el pedido no, va a revisar. */
const QUE_CAMBIAN = ["aguja","edad","vias","material","esteril","lumen"];
const DEFECTO = { vias:2, aguja:false };      // Foley de 2 vías y jeringa sin aguja: lo que se entiende si no se dice
// …salvo las de tuberculina e insulina, que suelen venir con aguja: ahí no se supone nada
function defecto(k, ...fichas){
  if(k==="aguja" && fichas.some(d=>d && (d.tipos||[]).some(t=>t==="tuberculina"||t==="insulina"))) return null;
  if(k==="material" && fichas.some(d=>d && d._fam==="sonda foley")) return "látex";   // la Foley común es de látex
  return DEFECTO[k];
}
const NOMBRE_DATO = {G:"calibre", largo:"largo", Fr:"French", num:"número", K:"código K", ml:"volumen", cm:"medida en cm", metros:"largo",
  gramos:"peso", pct:"%", vol:"volúmenes", vias:"vías", lumen:"lúmenes", talle:"talle", calibre:"calibre", material:"material",
  esteril:"estéril", polvo:"polvo", aguja:"aguja", edad:"edad", tipos:"tipo"};
const valor = (k,v) => k==="vias" ? v+" vías" : k==="lumen" ? v+" lúmenes" : k==="metros" ? v+" m" : k==="cm" ? v+" cm" : k==="esteril" ? (v?"estéril":"no estéril") : k==="aguja" ? (v?"con aguja":"sin aguja") : k==="polvo" ? (v?"con polvo":"sin polvo")
  : Array.isArray(v) ? v.join(", ") : k==="ml" && v>=1000 ? (v/1000)+" L" : String(v);

/* La familia sale SÓLO del nombre: la categoría de Odoo engaña («EQUIPO DE
   CIRUGIA» vive en Barbijos, el papel de ECG junto a los electrodos). Las
   notas de venta del nombre («(Caja x 6 – Precio x Caja)») no son datos. */
function fichaInsumo(texto, categoria){
  const limpio = String(texto||"").replace(/\(([^()]*)\)/g,(t,d)=>/precio|caja\s*x|blister|tira|pack|bulto|unidades/i.test(d)?" ":t)
    .replace(/(SE\s+)?VEN(DE|TA)\s+(POR\s+)?CAJA\s+CERRADA/ig," ");
  const fam = familiaDe(" "+norm(limpio).replace(/[^a-z0-9%\/ ]+/g," ")+" ");
  const datos = fam ? datosInsumo(limpio) : {};
  /* «ABBOCATH 20», «SONDA FOLEY 18»: el número suelto es el calibre o el French.
     Sólo si hay UNO solo en el rango, para no tomar una cantidad por calibre. */
  if(fam){
    const sueltos = (" "+norm(limpio)+" ").replace(/\d+\s?(ml|cc|cm|mm|mts?|lts?|l|g|gr|fr|f|ch|v|vias|%|x)\b/g," ").match(/(?<![\d.\/])\b\d{1,2}\b(?![.\/]\d)/g) || [];
    const en = (a,b) => sueltos.map(Number).filter(n=>n>=a && n<=b);
    if((fam==="cateter iv"||fam==="butterfly") && datos.G==null){
      const c = datos.num!=null ? [datos.num] : en(14,27);
      if(c.length===1){ datos.G = c[0]; delete datos.num; }
    }
    if((fam==="sonda foley"||fam==="sonda") && datos.Fr==null && datos.num==null){
      const c = en(6,30); if(c.length===1) datos.num = c[0];
    }
  }
  return { texto:String(texto||""), familia:fam, datos };
}

function compararInsumo(p, e){
  if(!p.familia) return {nivel:"distinto", motivos:["no reconozco el insumo del pedido"]};
  if(p.familia!==e.familia) return {nivel:"distinto", motivos:["otro insumo ("+(e.familia||"sin familia")+")"]};
  const pd=Object.assign({_fam:p.familia},p.datos), ed=Object.assign({_fam:e.familia},e.datos), motivos=[];
  // lo que define la familia
  for(const alt of (CLAVE_FAMILIA[p.familia]||[])){
    const ks = alt.split("|");
    const kp = ks.find(k=>pd[k]!=null), ke = ks.find(k=>ed[k]!=null);
    if(!kp){ motivos.push("el pedido no dice el "+NOMBRE_DATO[ks[0]]); continue; }
    if(!ke){ motivos.push("el producto no dice el "+NOMBRE_DATO[ks[0]]); continue; }
    if(String(pd[kp])!==String(ed[ke])) return {nivel:"distinto", motivos:["otro "+NOMBRE_DATO[kp]+" ("+valor(ke,ed[ke])+" en vez de "+valor(kp,pd[kp])+")"]};
  }
  // todo lo demás que dice el pedido tiene que estar igual en el producto
  for(const k of Object.keys(pd)){
    if(k[0]==="_" || k==="Gnot" || (CLAVE_FAMILIA[p.familia]||[]).some(a=>a.split("|").includes(k))) continue;
    if(k==="tipos"){
      const faltan = pd.tipos.filter(t=>!(ed.tipos||[]).includes(t));
      if(faltan.length) motivos.push("el pedido dice "+faltan.join(", ")+" y el producto no");
      continue;
    }
    const ve = ed[k]!=null ? ed[k] : defecto(k, ed);
    if(ve==null){ motivos.push("el producto no dice "+NOMBRE_DATO[k]+" ("+valor(k,pd[k])+")"); continue; }
    if(String(ve)!==String(pd[k])) return {nivel:"distinto", motivos:["otro "+NOMBRE_DATO[k]+" ("+valor(k,ve)+" en vez de "+valor(k,pd[k])+")"]};
  }
  // lo que trae el producto y cambia el producto aunque el pedido no lo diga
  for(const k of QUE_CAMBIAN){
    if(ed[k]==null || pd[k]!=null) continue;
    const df = defecto(k, ed, pd);
    if(df!=null && String(ed[k])===String(df)) continue;
    motivos.push("es "+valor(k,ed[k])+"; el pedido no lo dice");
  }
  // medidas que trae el producto y el pedido no dice (la llave «con prolongador de 30 cm»): a revisar.
  // El largo de una venda o cinta (2,7 m, 9 m) no cambia lo que se pide.
  const clave = (CLAVE_FAMILIA[p.familia]||[]).join("|").split("|");
  for(const k of ["G","largo","Fr","num","K","ml","cm","gramos","pct","vol","lumen","talle","calibre"]){
    if(ed[k]!=null && pd[k]==null && !clave.includes(k) && !(k==="G"&&pd.Gnot) ) motivos.push("es "+NOMBRE_DATO[k]+" "+valor(k,ed[k])+"; el pedido no lo dice");
  }
  const extraTipos = (ed.tipos||[]).filter(t=>!(pd.tipos||[]).includes(t) && !["hidrófilo","trozada"].includes(t));
  if(extraTipos.length && p.familia!=="guantes") motivos.push("es "+extraTipos.join(", ")+"; el pedido no lo dice");
  const nom = norm(e.texto);
  const raras = rarasInsumo(p.texto).filter(w=>!new RegExp("\\b"+w+"\\b").test(nom));   // si el producto la tiene, es su marca
  if(raras.length) motivos.push("el pedido dice «"+raras.join(" ").toUpperCase()+"» y no sé qué es");
  return { nivel: motivos.length ? "revisar" : "igual", motivos };
}

/* Palabras del pedido de un insumo que no se entienden → a revisar (como en
   los medicamentos: «ABBOCATH 14 - NO HARDSON - NO DEXAL»). */
const CONOCIDAS_INSUMO = new Set(("aguja agujas jeringa jeringas cateter cateteres intravenoso periferico abbocath abocath abbocat jelco branula central lumen "+
  "doble triple simple sonda sondas foley vias via latex silicona nelaton nasogastrica gastrica aspiracion intubacion levin mucus "+
  "guante guantes nitrilo vinilo esteril esteriles examen cirugia quirurgico talle par pares venda vendas yeso enyesada cambric ovata elastica "+
  "autoadherente tubular cinta tela adhesiva micropore hipoalergenica hipoaler papel transpore zinc oxido alcohol gel liquido vaselina solida "+
  "agua oxigenada volumenes barbijo barbijos triple capa tricapa especulo especulos vaginal bajalengua bajalenguas llave llaves prolongador equipo "+
  "suero perfusion macrogotero microgotero bisturi hoja hojas electrodo electrodos gasa gasas trozada algodon hidrofilo plegado cofia cofias "+
  "aerocamara aerocamaras mascara mascaras reservorio nebulizacion oxigeno descartador descartadores cortopunzantes butterfly mariposa "+
  "descartable descartables desc hipodermica uso unico unidad unidades caja cajas bolsa pote frasco fco fsco rollo rollos metros mts cm mm ml cc "+
  "litro litros lts kg gr grs gramos pulg con sin para tipo adulto adultos pediatrico pediatrica neonatal infantil de del la el los las nro "+
  "fraguado rapido comun puno manga larga tuberculina insulina luer lock pico vertedor dosificador valvula estandar mediano grande chico "+
  "espinal raquidea quincke epidural peridural tuohy punta "+
  // cortas que se entienden; las cortas que NO están acá suelen ser marcas («22-BD», «TRB», «KLF»)
  "de cm ml con nro par fr cc no vol sin im al mts mtr mtrs ev ref lt gr fco gel abb del mm asp reg lts kg grs un est neb gs liq en kn "+
  "uso adm env sc nsg iv ped cal ch nº mt").split(" "));
function rarasInsumo(texto){
  return [...new Set(tokens(texto))].filter(w=>w.length>=2 && !/\d/.test(w) && !CONOCIDAS_INSUMO.has(w) && !/^(xs|xl|xxl|s|m|l|g|f|x|v|y|o|a|p|t|k|n)$/.test(w));
}

const API = { norm, tokens, armarDiccionario, drogasDeTexto, dosisDeTexto, formaDeTexto, ficha, comparar, componente,
  fichaInsumo, compararInsumo, rarasInsumo, datosInsumo, familiaDe };
if(typeof module!=="undefined" && module.exports) module.exports = API;
else raiz.RECONOCER = API;
})(typeof window!=="undefined" ? window : globalThis);
