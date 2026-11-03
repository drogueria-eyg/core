/* ===== EyG Core · VISUAL NUEVA =====
   Pone la clase html.v2 (que activa assets/v2.css), carga Exo 2, cambia el
   monograma viejo por el logo del portal, reemplaza los emojis por íconos de
   línea y TRADUCE los colores fijos de cada pantalla a la paleta nueva.

   Por qué un traductor: cada módulo trae su propio <style> (panel.html tiene
   74 KB) y además arma HTML con colores en línea. Reescribirlos a mano sería
   tocar miles de reglas y arriesgar romper algo. El traductor lee cada color,
   lo clasifica (blanco, tinte claro, petróleo, gris, verde/rojo/ámbar…) y lo
   cambia por la variable del tema que le corresponde. Sólo toca colores,
   sombras, radios y la familia tipográfica: nunca medidas ni posiciones. Y
   como todo termina en variables, el modo oscuro es redefinir las variables.

   Quién la ve: todos, en todas las pantallas (desde el 3/11/2026; antes fue un
   piloto de Diego y Germán). Se carga en el <head> de cada página, así arranca
   antes de que se dibuje nada y no hay un instante con la visual vieja.
   Salida de emergencia: ?visual=vieja la apaga y ?visual=nueva la vuelve a
   prender (queda recordado en ese navegador). El modo oscuro se elige con el
   botón del menú lateral (o del encabezado, en las pantallas sin menú). */
window.EYGV2 = (function(){
  const LS = "eyg_visual", LS_TEMA = "eyg_tema";
  const SELF = (document.currentScript && document.currentScript.src) || "";
  const ASSETS = SELF.replace(/v2\.js(\?.*)?$/, "");
  const H = document.documentElement;
  const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const lsSet = (k,v) => { try{ localStorage.setItem(k,v); }catch(e){} };

  function quiereNueva(){
    const q = new URLSearchParams(location.search).get("visual");
    if(q==="vieja" || q==="nueva") lsSet(LS, q);
    return (lsGet(LS) || "nueva") === "nueva";
  }

  /* ================= Traductor de colores ================= */
  function parse(s){
    s = s.trim().toLowerCase();
    if(s==="white") return {r:255,g:255,b:255,a:1};
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if(m){
      let h=m[1];
      if(h.length===3||h.length===4) h=h.split("").map(c=>c+c).join("");
      if(h.length!==6&&h.length!==8) return null;
      return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16),a:h.length===8?parseInt(h.slice(6,8),16)/255:1};
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if(m){ let a=m[4]==null?1:(m[4].endsWith("%")?parseFloat(m[4])/100:parseFloat(m[4])); return {r:+m[1],g:+m[2],b:+m[3],a}; }
    return null;
  }
  function hsl({r,g,b}){
    r/=255; g/=255; b/=255;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2;
    let h=0, s=0;
    if(mx!==mn){
      const d=mx-mn; s = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
      h = mx===r ? (g-b)/d+(g<b?6:0) : mx===g ? (b-r)/d+2 : (r-g)/d+4; h*=60;
    }
    return {h,s,l};
  }
  const v = n => `var(--${n})`;
  const TEAL = h => h>=150 && h<=200;
  const OSC = new Set(["brand","brand-2","tip"]);            // fondos oscuros: llevan texto claro
  const OSC_TXT = new Set([...OSC, "gris2"]);                // fondos sobre los que el texto va claro
  const CLAROS = new Set(["surface","bg2","agua","soft","okbg","badbg","warnbg","infobg","tribg","lime"]);

  /* Devuelve el nombre del token (sin var()) o null para dejar el color como está. */
  function tokenFondo(c){
    if(c.a<0.04) return null;
    const {h,s,l}=hsl(c);
    if(c.a<1) return null;                                   // velos y transparencias: quedan
    if(l>=0.985 && s<0.6) return "surface";
    if(l>=0.9){
      if(s<0.2 || TEAL(h)) return l>=0.962 ? "bg2" : "agua";
      if(h>=80&&h<150) return "okbg";
      if(h<20||h>=330) return "badbg";
      if(h<70) return "warnbg";
      if(h<260) return "infobg";
      return "tribg";
    }
    if(l>=0.78 && (s<0.25 || TEAL(h))) return "soft-line";
    if(l>=0.8){                                                 // tintes de chips (beige, rosa, celeste…)
      if(h>=80&&h<150) return "okbg";
      if(h<20||h>=330) return "badbg";
      if(h<70) return "warnbg";
      if(h<260) return "infobg";
      return "tribg";
    }
    if(TEAL(h) && s>0.25 && l<0.5) return l<0.25 ? "brand" : "brand-2";
    if(TEAL(h) && s>0.25 && l<0.78) return "aqua";                                     // verde agua medio (barras, chips)
    if(l<0.2 && (s<0.4 || TEAL(h))) return "tip";
    if(s<0.2 && l>=0.35 && l<0.78) return "gris2";                                     // chips y pastillas grises
    if(s>0.5 && l>0.38 && l<0.78 && h>=8 && h<50) return "lime";                       // coral y dorado → acento lima
    return null;
  }
  function tokenTexto(c, fondo){
    if(c.a<0.04) return null;
    const {h,s,l}=hsl(c);
    const oscuro = fondo && OSC_TXT.has(fondo), claro = fondo && CLAROS.has(fondo);
    if(fondo==="lime") return "on-lime";
    if(c.r>235&&c.g>235&&c.b>235) return claro ? "petrol" : (c.a<1?null:"on-brand");
    /* Un verde agua clarito como texto sólo se lee sobre petróleo: ahí es donde se usaba
       (rótulos de tarjetas oscuras, subtítulos del encabezado). Va el gris papel de marca. */
    if(TEAL(h) && s>0.2 && l>0.6) return claro ? "petrol-2" : "on-brand-2";
    if(l>0.8 && s<0.25) return claro ? "gris" : "on-brand-2";
    if(oscuro) return (TEAL(h)&&s>0.2) ? "on-brand-2" : null;
    if(TEAL(h) && s>0.2) return l<0.33 ? "petrol" : "petrol-2";
    if(l<0.22 && s<0.45) return "ink";
    if(s<0.18) return l<0.5 ? "gris" : "gris2";
    if(h>=80&&h<165 && s>0.3) return "ok";
    if((h<15||h>=340) && s>0.3) return "bad";
    if(h>=15&&h<58 && s>0.3) return "warn";
    if(h>=195&&h<250 && s>0.3) return "info";
    if(h>=250&&h<320 && s>0.3) return "tri";
    return null;
  }
  function tokenLinea(c){
    if(c.a<0.04) return null;
    const {h,s,l}=hsl(c);
    if(c.a<1) return null;
    if(l>=0.985) return "surface";
    if(l>=0.8 && (s<0.3 || TEAL(h))) return "line";
    if(TEAL(h) && s>0.2) return "brand-2";
    if(s>0.55 && l>0.5 && l<0.78 && ((h>=8&&h<28)||(h>=32&&h<48))) return "lime-ink";
    return null;
  }
  function tokenGrafico(c){
    if(c.a<0.04) return null;
    const {h,s,l}=hsl(c);
    if(c.r>235&&c.g>235&&c.b>235) return "surface";
    if(TEAL(h) && s>0.2){ if(l>=0.82) return "track"; return l<0.25 ? "brand" : (l<0.5 ? "brand-2" : "aqua"); }
    if(s<0.15 && l>0.85) return "track";
    if(s<0.15 && l<0.25) return "ink";
    return null;
  }
  const RXC = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b/g;
  const conColores = (val, fn) => val.replace(RXC, m => { const c=parse(m); const t=c&&fn(c); return t ? v(t) : m; });

  /* Las variables viejas del Core se usaban igual para fondo y para texto (--teal-deep
     pinta el encabezado Y los títulos). En el modo oscuro eso no puede ser lo mismo,
     así que se separan según la propiedad donde aparecen. */
  const VAR_FONDO = {teal:"brand","teal-deep":"brand","teal-med":"brand-2",aqua:"brand-2",coral:"lime",gold:"lime"};
  const VAR_LINEA = {teal:"brand-2","teal-deep":"brand-2","teal-med":"brand-2",aqua:"hover-line",coral:"lime-ink",gold:"lime-ink"};
  const varTexto = (n, fondo) => {
    const oscuro = fondo && OSC_TXT.has(fondo);
    if(oscuro && /^teal/.test(n)) return "on-brand";
    if(fondo==="lime") return "on-lime";
    return ({teal:"petrol","teal-deep":"petrol","teal-med":"petrol-2",
             aqua: oscuro||!fondo ? "on-brand-2" : "petrol-2", surface:"on-brand", coral:"coral-txt", gold: oscuro ? "lime" : "warn"})[n];
  };
  const conVars = (val, fn) => val.replace(/var\(--([a-z0-9-]+)\)/g, (m,n)=>{ const t=fn(n); return t ? v(t) : m; });

  function sombra(val){
    if(/^\s*none\s*$/i.test(val)) return val;
    const partes = val.split(/,(?![^(]*\))/);
    const quedan = partes.map(p=>{
      if(/inset/.test(p)) return conVars(conColores(p, c=>tokenLinea(c)||tokenTexto(c)), n=>VAR_LINEA[n]);
      const m = p.match(RXC); const c = m && parse(m[0]);
      const largos = (p.replace(RXC,"").match(/-?[\d.]+px/g)||[]).map(x=>Math.abs(parseFloat(x)));
      const blur = largos[2]||0;
      /* el portal no usa sombras: sólo queda la elevación de ventanas y menús (oscura, difusa) */
      if(!c || c.a<0.2 || blur<20 || hsl(c).l>0.3) return null;
      return p.replace(RXC, `rgba(10,30,28,${Math.min(c.a,.3)})`);
    }).filter(Boolean);
    return quedan.length ? quedan.join(",") : "none";
  }
  function fondo(val){
    if(/url\(/.test(val) && !/gradient/.test(val)) return {val, tok:null};
    const toks=[];
    let nuevo = conVars(val, n=>{ const t=VAR_FONDO[n]||({surface:"surface",agua:"agua",bg:"bg2",okbg:"okbg",badbg:"badbg",warnbg:"warnbg"})[n]; if(t) toks.push(t); return VAR_FONDO[n]; });
    nuevo = nuevo.replace(RXC, m=>{ const c=parse(m); const t=c&&tokenFondo(c); toks.push(t||(c&&c.a<1?"~":null)); return t?v(t):m; });
    if(/gradient/.test(val)){
      /* Sólo se aplanan los degradados SIMPLES (una sola capa lineal o un brillo radial).
         Los anillos de progreso son dos capas —un círculo radial color papel encima de un
         cónico que dibuja el arco— y aplanarlos borraba el arco (3/11/2026: los anillos
         de "Tus objetivos" del panel del comercial no se veían). */
      const capas = (val.match(/gradient\(/g)||[]).length;
      const simple = capas===1 && !/url\(/.test(val);
      const firmes = toks.filter(t=>t && t!=="~");
      if(simple && /radial-gradient/.test(val) && !firmes.length && toks.length) return {val:"none", tok:null};   // brillos decorativos: fuera
      if(simple && /^\s*linear-gradient/.test(val) && firmes.length){
        if(firmes.every(t=>OSC.has(t))) return {val:v("brand"), tok:"brand"};                                   // degradé petróleo → plano
        if(firmes.every(t=>CLAROS.has(t))) return {val:v(firmes[0]), tok:firmes[0]};                            // degradé claro → plano
      }
      return {val:nuevo, tok:null};
    }
    return {val:nuevo, tok:toks.find(t=>t && t!=="~")||null};
  }
  function radio(val){
    return val.replace(/(\d+(?:\.\d+)?)px/g, (m,n)=>{ n=+n; if(n>=12&&n<=18) return "9px"; if(n>18&&n<40) return "6px"; return m; });
  }

  /* Traduce una lista de declaraciones "a:b;c:d" (cuerpo de una regla o un style="…"). */
  /* Variables propias de cada página (":root{--muted:#8A9A97}"): se traducen según el
     nombre o, si no dice nada, según lo claro del color. Las que la piel ya define
     (--ink, --teal, …) quedan como están: html.v2 les gana igual y traducirlas
     armaría un ciclo (--ink: var(--ink)). */
  const TOKENS = new Set(("brand brand-2 on-brand on-brand-2 lime on-lime coral-txt ink gris gris2 petrol petrol-2 icon lime-ink "+
    "bg bg2 surface agua soft chip track line soft-line field btn-line hover-line tip ok okbg bad badbg warn warnbg info infobg "+
    "tri tribg teal teal-deep teal-med aqua coral radius shadow gold paper wa").split(" "));
  const RXC1 = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b/;
  function varPropia(nombre, val){
    const n = nombre.slice(2).toLowerCase();
    if(TOKENS.has(n)) return val;
    if(/shadow|sombra/.test(n)) return sombra(val);
    if(/radius|radio/.test(n)) return radio(val);
    const m = val.match(RXC1); const c = m && parse(m[0]);
    if(!c) return val;
    const tipo = /bg|fondo|surface|card|panel|paper|papel|back|base/.test(n) ? "fondo"
               : /line|border|borde|sep/.test(n) ? "linea"
               : /txt|text|ink|fg|muted|gris|tinta/.test(n) ? "texto"
               : (hsl(c).l>=0.85 ? "fondo" : "texto");
    if(tipo==="fondo") return conColores(val, x=>{ const k=hsl(x); return (k.l<0.15 && /bg|fondo|base/.test(n)) ? "bg" : tokenFondo(x); });
    if(tipo==="linea") return conColores(val, tokenLinea);
    return conColores(val, x=>tokenTexto(x, null));
  }
  const DECL = /([-a-zA-Z0-9_]+)(\s*:\s*)((?:[^;"'(]|\((?:[^()]|\([^)]*\))*\)|"[^"]*"|'[^']*')+)/g;
  function declaraciones(txt){
    let fondoTok=null, hay=false;
    txt.replace(DECL, (all,p,sep,val)=>{ hay=true; p=p.toLowerCase(); if(p==="background"||p==="background-color"||p==="background-image"){ const r=fondo(val); if(r.tok) fondoTok=r.tok; } return all; });
    if(!hay) return txt;
    /* Un fondo que pasa a lima (era coral o dorado) lleva texto petróleo: si la regla no
       trae color propio, el blanco que heredaba de otra regla no se leería. */
    const sinColor = fondoTok==="lime" && !/(^|[;{\s])color\s*:/i.test(txt);
    const res = txt.replace(DECL, (all,p,sep,val)=>{
      const P=p.toLowerCase();
      let nv=val;
      if(P==="background"||P==="background-color"||P==="background-image") nv=fondo(val).val;
      else if(P==="color"||P==="-webkit-text-fill-color") nv=conVars(conColores(val, c=>tokenTexto(c, fondoTok)), n=>varTexto(n, fondoTok));
      else if(P==="box-shadow") nv=sombra(val);
      else if(P==="text-shadow") nv="none";
      else if(P==="fill"||P==="stroke"||P==="stop-color") nv=conVars(conColores(val, tokenGrafico), n=>VAR_FONDO[n]);
      else if(/^(border|outline|text-decoration|column-rule)/.test(P) && !/radius/.test(P)) nv=conVars(conColores(val, tokenLinea), n=>VAR_LINEA[n]);
      else if(/radius$/.test(P)) nv=radio(val);
      else if(P==="font-family" && /archivo/i.test(val)) nv="inherit";
      else if(P.startsWith("--")) nv=varPropia(P, val);
      return nv===val ? all : p+sep+nv;
    });
    return sinColor ? res.replace(/;?\s*$/, ";color:var(--on-lime)") : res;
  }
  /* Una hoja de estilos entera: se traduce cada bloque más interno (incluye los de @media). */
  function hoja(css){
    return css.replace(/\{([^{}]*)\}/g, (all, cuerpo)=> /@font-face|src\s*:/.test(cuerpo) ? all : "{"+declaraciones(cuerpo)+"}");
  }

  const ORIG = new Map();    // <style> → texto original, para poder volver atrás sin recargar
  /* Pantallas HUD, pensadas oscuras (Mapa del sistema, Tablero en vivo, Asistente,
     consola de WhatsApp): su <body> trae un fondo casi negro y tienen su propio juego
     de colores neón (--hud-*, --tb-*, y también --agua o --gris usados como TEXTO).
     Traducirlas como si fueran claras las apagaba. Se quedan con sus colores, en el
     modo oscuro de la piel (menú, tipografía, logo, íconos), y sus variables ganan
     sobre las de la piel aunque se llamen igual. */
  function esOscura(css){
    const vars={}; css.replace(/(--[\w-]+)\s*:\s*([^;}]+)/g,(a,n,v)=>{ vars[n]=v.trim(); return a; });
    const reglas = [...css.matchAll(/(?:^|[}\s,])(?:html\s*,\s*)?body\s*\{([^}]*)\}/g)];
    for(const b of reglas){
      const bg = b[1].match(/background(?:-color)?\s*:\s*([^;}]+)/);
      if(!bg) continue;
      let val = bg[1];
      for(let i=0;i<3;i++) val = val.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g,(a,n)=>vars[n]||a);
      const m = val.match(RXC1); const c = m && parse(m[0]);
      if(c) return hsl(c).l < 0.2;
    }
    return false;
  }
  function fijarOscuro(){ H.dataset.v2Fijo = "oscuro"; H.classList.add("v2hud"); aplicarTema("oscuro"); }
  const esHud = () => H.classList.contains("v2hud");
  const hud = css => css.replace(/(^|[},])\s*:root\s*\{/g, "$1 html.v2.v2hud:root{");

  function traducirEstilos(){
    document.querySelectorAll("style:not([data-v2])").forEach(st=>{
      if(st.id==="v2-fuente") return;
      if(esOscura(st.textContent)) fijarOscuro();
      ORIG.set(st, st.textContent);
      st.textContent = esHud() ? hud(st.textContent) : hoja(st.textContent);
      st.dataset.v2 = "1";
    });
    /* Las hojas compartidas del Core (core.css, home.css, producto.css…) también traen
       colores fijos. Se leen ya cargadas, se traducen a un <style> puesto justo después
       (mismo orden de cascada) y la hoja original queda apagada, no borrada. */
    document.querySelectorAll('link[rel="stylesheet"]:not([data-v2])').forEach(l=>{
      if(!/\/assets\/[^/]+\.css/.test(l.href) || /\/v2\.css/.test(l.href)) return;
      let reglas; try{ reglas = l.sheet && l.sheet.cssRules; }catch(e){ return; }
      if(!reglas){ l.addEventListener("load", ()=>programar(), {once:true}); return; }
      const st = document.createElement("style");
      st.dataset.v2 = "1"; st.dataset.v2De = l.getAttribute("href"); if(l.media) st.media = l.media;
      st.textContent = hoja([...reglas].map(r=>r.cssText).join("\n"));
      l.after(st);
      l.dataset.v2 = "1"; l.dataset.v2Media = l.media || ""; l.media = "not all";
    });
  }
  function traducirUno(e){
    if(!e || e.nodeType!==1 || esHud()) return;
    if(e.hasAttribute("style")){
      const s=e.getAttribute("style");
      if(e.__v2s!==s){ const n=declaraciones(s); if(n!==s) e.setAttribute("style", n); e.__v2s=e.getAttribute("style"); }
    }
    if(e.namespaceURI==="http://www.w3.org/2000/svg"){
      for(const a of ["fill","stroke","stop-color"]){
        const val=e.getAttribute(a);
        if(!val || val.startsWith("var(") || val==="none") continue;
        const c=parse(val); const t=c&&tokenGrafico(c);
        if(t) e.style.setProperty(a, v(t));                  // el atributo no acepta var(): va como estilo
      }
      e.__v2s=e.getAttribute("style");
    }
  }
  function traducirNodo(el){
    if(!el || el.nodeType!==1 || esHud()) return;
    traducirUno(el);
    el.querySelectorAll("[style],[fill],[stroke],[stop-color]").forEach(traducirUno);
  }

  /* ================= Íconos de línea (24×24, trazo 1,6, como .eyg-r-icon del portal) ================= */
  const P = {
    home:'<path d="M3 11 12 4l9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
    chat:'<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
    hosp:'<path d="M4 21V6h16v15"/><path d="M2 21h20"/><path d="M12 9v6M9 12h6"/>',
    megaf:'<path d="M3 10v4h4l8 5V5l-8 5z"/><path d="M18.5 8.5a5 5 0 0 1 0 7"/>',
    bolt:'<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
    chart:'<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
    calc:'<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
    target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
    box:'<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
    pill:'<path d="M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7z"/><path d="m8.5 8.5 7 7"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    inbox:'<path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5.5 5h13L20 13v6H4v-6z"/>',
    tag:'<path d="M3 12V4h8l10 10-8 8z"/><path d="M7.5 7.5h.01"/>',
    pulse:'<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
    clip:'<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H5v16h14V5h-3M9 12h6M9 16h4"/>',
    link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    merge:'<path d="M4 7h4l8 10h4M4 17h4l2-2.5M14 9.5 16 7h4"/><path d="m18 5 2 2-2 2M18 15l2 2-2 2"/>',
    users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    map:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    nodes:'<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m6.5 6.5 3.4 3.4M17.5 6.5l-3.4 3.4M6.5 17.5l3.4-3.4M17.5 17.5l-3.4-3.4"/>',
    spark:'<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>',
    globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    flask:'<path d="M9 3h6M10 3v6l-5.6 9.9A1.4 1.4 0 0 0 5.6 21h12.8a1.4 1.4 0 0 0 1.2-2.1L14 9V3"/><path d="M7.2 15h9.6"/>',
    bank:'<path d="M3 10h18L12 4z"/><path d="M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3 21h18"/>',
    paw:'<circle cx="7" cy="9" r="1.8"/><circle cx="17" cy="9" r="1.8"/><circle cx="10" cy="5.5" r="1.8"/><circle cx="14" cy="5.5" r="1.8"/><path d="M12 12c-3 0-5.5 3.5-5.5 6 0 1.7 1.6 2.4 3 1.8 1.6-.6 3.4-.6 5 0 1.4.6 3-.1 3-1.8 0-2.5-2.5-6-5.5-6z"/>',
    money:'<rect x="3" y="6.5" width="18" height="11" rx="1.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 10v4M17.5 10v4"/>',
    card:'<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3 10h18M7 15h3"/>',
    out:'<rect x="3" y="6.5" width="18" height="11" rx="1.5"/><path d="M12 15V9m-2.5 2.5L12 9l2.5 2.5"/>',
    folder:'<path d="M3 6h6l2 2h10v11H3z"/>',
    book:'<path d="M12 5v15M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1z"/>',
    receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    idcard:'<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8.5" cy="10.5" r="2"/><path d="M5.5 16a3 3 0 0 1 6 0M14 9.5h4M14 13h4"/>',
    trend:'<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    cal:'<rect x="4" y="5" width="16" height="16" rx="1.5"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    alert:'<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    trophy:'<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3.5 3.5 0 0 0 4 4M16 6h3.5a3.5 3.5 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>',
    arrow:'<path d="M7 17 17 7M9 7h8v8"/>',
    phone:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    bot:'<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01M9.5 16h5"/>',
    pen:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
    heart:'<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    truck:'<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
    cart:'<path d="M3 4h2l2.2 11h10.6L20 7H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
    bell:'<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    star:'<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
    medal:'<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 3h7L13.5 9h-3z"/>',
    gift:'<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8.5V20M12 8.5C10 4 6.5 5 7.5 7.3 8 8.5 12 8.5 12 8.5zM12 8.5c2-4.5 5.5-3.5 4.5-1.2-.5 1.2-4.5 1.2-4.5 1.2z"/>',
    fire:'<path d="M12 21a7 7 0 0 0 7-7c0-4-3.5-6-4-10-2 2-3 4-3 6-1-1-2-1.5-2.5-3C7 9 5 11.5 5 14a7 7 0 0 0 7 7z"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="m3.5 6 8.5 7 8.5-7"/>',
    pin:'<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
    lock:'<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    refresh:'<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
    x:'<path d="m6 6 12 12M6 18 18 6"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    drop:'<path d="M12 3.5s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
    trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    gem:'<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16M15 4l-3 16"/>',
    crown:'<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    ban:'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    printer:'<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>',
    snow:'<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>',
    flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    pie:'<path d="M12 3v9h9a9 9 0 1 1-9-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    image:'<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>',
    scale:'<path d="M12 4v16M7 20h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    dot:'<circle cx="12" cy="12" r="3"/>',
  };
  const EMO = {
    "🏠":"home","💬":"chat","🗨":"chat","🏥":"hosp","📣":"megaf","📢":"megaf","⚡":"bolt","📊":"chart","📉":"chart","🧮":"calc","💯":"target","🎯":"target",
    "📦":"box","💊":"pill","🔎":"search","🔍":"search","📥":"inbox","🏷":"tag","🩺":"pulse","🫀":"heart","💡":"bulb","📋":"clip","📝":"pen",
    "🤝":"link","🔀":"merge","👥":"users","👤":"user","🧑":"user","🗺":"map","🧠":"nodes","✨":"spark","🌐":"globe","⚙":"gear","🧭":"target",
    "⚗":"flask","🏛":"bank","🏦":"bank","🐾":"paw","💰":"money","💵":"money","💲":"money","💳":"card","💸":"out","📁":"folder","📂":"folder","📚":"book","📖":"book",
    "🧾":"receipt","🪪":"idcard","📈":"trend","📅":"cal","🗓":"cal","📆":"cal","⚠":"alert","⛔":"alert","🚨":"alert","❗":"alert","🏆":"trophy","🚀":"arrow",
    "📱":"phone","📞":"phone","☎":"phone","🤖":"bot","✍":"pen","✏":"pen","📐":"chart","✅":"check","✔":"check","☑":"check","⏰":"clock","⏱":"clock","🕒":"clock","⏳":"clock","⌛":"clock",
    "🚚":"truck","🛒":"cart","🔔":"bell","⭐":"star","🌟":"star","🥇":"medal","🥈":"medal","🥉":"medal","🏅":"medal","🎖":"medal","🎁":"gift","🔥":"fire",
    "📧":"mail","✉":"mail","📨":"mail","📤":"out","📍":"pin","📌":"pin","👀":"eye","👁":"eye","🔑":"key","🔒":"lock","🔐":"lock","🔄":"refresh","🔁":"refresh",
    "❌":"x","✖":"x","🗂":"folder","🎉":"spark","🆕":"star","🩸":"drop","🗑":"trash","💎":"gem","👑":"crown","🚫":"ban","🕐":"clock",
    "👌":"check","📩":"mail","💾":"save","📄":"doc","📃":"doc","🔓":"lock","🖨":"printer","👏":"spark","🎟":"tag","🧩":"nodes","✂":"x","☀":"sun","🌤":"sun",
    "❄":"snow","😴":"moon","♻":"refresh","🏁":"flag","🥧":"pie","🪣":"box","💪":"bolt","🔻":"alert","🕳":"dot","☕":"clock","💚":"heart","❤":"heart","🔗":"link",
    "🔖":"tag","🖼":"image","🚧":"alert","⚖":"scale","➕":"plus","➖":"dot","ℹ":"info","❔":"info","❓":"info","🏢":"bank","🏪":"hosp","👋":null,
  };
  const DOTS = {"🔴":"bad","🟠":"warn","🟡":"warn","🟢":"ok","🔵":"info","🟣":"tri","⚪":"gris2","⚫":"ink","🟩":"ok","🟥":"bad","🟨":"warn"};
  const svg = (k,cls="v2i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[k]||P.dot}</svg>`;
  /* Flechas, ©, ™ y cuadraditos son tipografía de los botones ("Ver todo →"), no emojis. */
  const TIPO = "(?![\\u00A9\\u00AE\\u2122\\u2190-\\u21FF\\u2934\\u2935\\u25AA-\\u25FE\\u27A1\\u2B05-\\u2B07])";
  const RX = new RegExp(TIPO+"[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}]", "u");
  const RX_ALL = new RegExp(TIPO+"[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}]|[\\u{1F3FB}-\\u{1F3FF}\\u200d\\ufe0f\\u20e3]", "gu");
  const SOLO = /^[\s\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️⃣]+$/u;
  const NO_TOCAR = "script,style,textarea,pre,code,input,select,option,[contenteditable],[data-v2-keep]";
  function iconoDe(txt){
    const t=(txt||"").replace(/[️‍]/g,"").trim();
    for(const ch of Array.from(t)){ if(DOTS[ch]) return {dot:DOTS[ch]}; if(ch in EMO) return EMO[ch]?{k:EMO[ch]}:null; }
    return {k:"dot"};
  }
  function iconoHTML(i){
    return i.dot ? `<svg class="v2i v2dot" viewBox="0 0 24 24" aria-hidden="true" style="fill:var(--${i.dot});stroke:none"><circle cx="12" cy="12" r="5"/></svg>` : svg(i.k);
  }
  /* Un texto con emojis: si el elemento es SÓLO el emoji (un casillero de ícono) va un ícono
     de línea; si el emoji acompaña un texto, se saca. */
  function emojis(raiz){
    if(!raiz) return;
    if(raiz.nodeType===3){ raiz = raiz.parentNode; if(!raiz) return; }
    if(raiz.nodeType!==1 || raiz.closest(NO_TOCAR)) return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const ns=[]; while(w.nextNode()) if(RX.test(w.currentNode.nodeValue)) ns.push(w.currentNode);
    for(const n of ns){
      const el=n.parentElement; if(!el || el.closest(NO_TOCAR)) continue;
      if(SOLO.test(n.nodeValue) && el.childNodes.length===1 && el.tagName!=="SVG"){
        const i=iconoDe(n.nodeValue);
        if(i){ el.innerHTML = iconoHTML(i); el.dataset.ic = i.k || "dot"; } else n.nodeValue="";   // data-ic: v2.css tiñe el casillero según el tema del ícono
        el.classList.add("v2ic");
        continue;
      }
      if(SOLO.test(n.nodeValue)){                               // emoji suelto pegado a otro elemento
        const i=iconoDe(n.nodeValue);
        const sp=document.createElement("span"); sp.className="v2ic v2ic-in";
        if(i) sp.innerHTML=iconoHTML(i);
        n.replaceWith(sp); continue;
      }
      const vv=n.nodeValue.replace(RX_ALL,"").replace(/ {2,}/g," ");
      n.nodeValue = n.previousSibling ? vv : vv.replace(/^\s+/,"");
    }
  }

  /* ================= Marca, menú y tema ================= */
  const LOGO = () => `<img class="v2logo" src="${ASSETS}logo-eyg.svg" alt="Droguería EyG">`;
  function marca(){
    const sb = document.querySelector(".sbrand a");
    if(sb && !sb.querySelector(".v2logo")) sb.innerHTML = LOGO()+`<span class="v2tag">Panel<b>interno</b></span>`;
    /* encabezados propios de algunos módulos (panel.html, cobranzas…): monograma "EyG" + "Core" */
    document.querySelectorAll(".topbar .mono, .eyg-top .mono, .login-card .brand .mono").forEach(m=>{
      if(m.querySelector(".v2logo")) return;
      m.innerHTML = LOGO(); m.classList.add("v2mono");
      const tg = m.nextElementSibling; if(tg && tg.classList.contains("tag")) tg.classList.add("v2tagcore");
    });
    const ham = document.querySelector(".mbar .ham");
    if(ham && !ham.querySelector("svg")) ham.innerHTML = svg("menu");
    const rh = document.querySelector(".eyg-railham");
    if(rh && !rh.querySelector("svg")) rh.innerHTML = svg("menu");
    const dh = document.querySelector(".mbody .dhead h1");
    if(dh && !dh.previousElementSibling?.classList?.contains("v2kick"))
      dh.insertAdjacentHTML("beforebegin", `<span class="v2kick">Resumen del día</span>`);
    /* selector claro/oscuro: al pie del menú lateral; en las pantallas sin menú
       (panel de un comercial, cobranzas de Bárbara…) va como botón chico en el encabezado */
    const BT = c => `<button type="button" class="v2tema${c}" onclick="EYGV2.alternarTema()" title="Cambiar entre modo claro y oscuro"></button>`;
    const sf = document.querySelector(".sfoot");
    if(sf){
      if(!sf.querySelector(".v2tema")) sf.insertAdjacentHTML("afterbegin", BT(""));
      document.querySelectorAll(".v2tema-mini").forEach(b=>b.remove());    // el menú llegó después: un solo botón
    }
    else {
      const tb = document.querySelector(".topbar, .eyg-top");
      if(tb && !tb.querySelector(".v2tema")) tb.insertAdjacentHTML("beforeend", BT(" v2tema-mini"));
    }
    pintarBotonTema();
  }
  function pintarBotonTema(){
    const osc = H.classList.contains("oscuro");
    document.querySelectorAll(".v2tema").forEach(b=>{
      const quiero = osc ? "claro" : "oscuro";
      if(b.dataset.m===quiero) return;
      b.dataset.m = quiero;
      b.innerHTML = svg(osc?"sun":"moon") + (b.classList.contains("v2tema-mini") ? "" : `<span>Modo ${quiero}</span>`);
      b.setAttribute("aria-label", `Pasar a modo ${quiero}`);
    });
  }
  function aplicarTema(t){
    if(H.dataset.v2Fijo) t = H.dataset.v2Fijo;
    H.classList.toggle("oscuro", t==="oscuro");
    H.style.colorScheme = t==="oscuro" ? "dark" : "light";
    pintarBotonTema();
  }
  function alternarTema(){
    const t = H.classList.contains("oscuro") ? "claro" : "oscuro";
    lsSet(LS_TEMA, t); aplicarTema(t);
  }

  /* ================= Pasadas ================= */
  let obs=null, pend=false, cola=new Set(), attrs=new Set(), todo=true;
  function pasar(){
    traducirEstilos();
    /* con core.js en el <head> la piel arranca antes de que exista el <body>: la primera
       pasada completa queda para cuando aparezca (lo avisa el observador) */
    if(todo && document.body){ traducirNodo(document.body); emojis(document.body); todo=false; }
    else for(const n of cola){ if(n.isConnected){ traducirNodo(n.nodeType===1?n:n.parentNode||document.body); emojis(n); } }
    cola.clear();
    /* gráficos que se repintan cambiando el estilo de un elemento que ya estaba
       (barras que crecen, celdas de calor, el período que cambia): sólo ese elemento */
    attrs.forEach(traducirUno); attrs.clear();
    marca();
  }
  function programar(recs){
    if(recs) for(const r of recs){
      if(r.type==="characterData") cola.add(r.target);
      else if(r.type==="attributes"){ if(r.target.__v2s!==r.target.getAttribute("style") || r.attributeName!=="style") attrs.add(r.target); }
      else r.addedNodes.forEach(n=>{ if(n.nodeType===1||n.nodeType===3) cola.add(n); });
    }
    /* Se pasa en el acto (el observador ya llega antes de que se pinte): así no hay un
       cuadro con los colores viejos, y no depende de requestAnimationFrame, que el
       navegador pausa con la pestaña en segundo plano. */
    if(pend) return; pend=true;
    if(obs) obs.disconnect();
    try{ pasar(); } catch(e){ console.warn("EYGV2:", e); } finally { pend=false; observar(); }
  }
  function observar(){
    if(!obs) obs = new MutationObserver(programar);
    obs.observe(document.documentElement, {childList:true, subtree:true, characterData:true,
      attributes:true, attributeFilter:["style","fill","stroke"]});
  }
  /* Exo 2 ya viene pedida en el <head> de cada página (id v2-fuente-link): sólo se
     inyecta si falta. La tipografía vieja (Archivo) se dejó de cargar; si alguien
     vuelve a la visual vieja con ?visual=vieja, off() la pide. */
  function fuente(){
    if(document.getElementById("v2-fuente-link")) return;
    const pc=document.createElement("link"); pc.rel="preconnect"; pc.href="https://fonts.gstatic.com"; pc.crossOrigin="";
    const l=document.createElement("link"); l.id="v2-fuente-link"; l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600&display=swap";
    document.head.append(pc,l);
  }

  function on(){
    if(H.classList.contains("v2")) return;
    H.classList.add("v2"); fuente();
    aplicarTema(lsGet(LS_TEMA)==="oscuro" ? "oscuro" : "claro");
    todo=true; observar(); programar();
  }
  function off(){
    if(!H.classList.contains("v2")) return;
    if(obs) obs.disconnect();
    H.classList.remove("v2","oscuro","v2hud"); delete H.dataset.v2Fijo; H.style.colorScheme="";
    ORIG.forEach((txt,st)=>{ st.textContent=txt; delete st.dataset.v2; }); ORIG.clear();
    document.querySelectorAll("style[data-v2-de]").forEach(st=>st.remove());
    document.querySelectorAll('link[data-v2]').forEach(l=>{ l.media = l.dataset.v2Media || ""; delete l.dataset.v2; });
  }

  /* Compatibilidad: las páginas del piloto llamaban aplicar(perfil) después del login.
     Una copia vieja de esas páginas en la caché del navegador lo puede seguir haciendo,
     así que se queda como sinónimo de "prender si corresponde". */
  const aplicar = () => { if(quiereNueva()) on(); };

  function fuenteVieja(){
    if(document.getElementById("v1-fuente-link")) return;
    const l=document.createElement("link"); l.id="v1-fuente-link"; l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&display=swap";
    document.head.append(l);
  }

  if(quiereNueva()) on(); else fuenteVieja();

  return { on, off, aplicar, svg, alternarTema, _hoja:hoja, _decl:declaraciones };
})();
