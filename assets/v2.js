/* ===== EyG Core · VISUAL NUEVA (piloto) =====
   Pone la clase html.v2 (que activa assets/v2.css), carga Exo 2, cambia el
   monograma viejo por el logo del portal y reemplaza los emojis por íconos de
   línea, como en el portal (que no usa emojis).
   El inicio se redibuja solo (reloj, sondeos), así que un observador vuelve a
   pasar la piel cada vez que algo cambia; la pasada es idempotente.

   Quién la ve: por ahora sólo PILOTO. Para comparar: ?visual=vieja la apaga y
   ?visual=nueva la vuelve a prender (queda recordado en este navegador). */
window.EYGV2 = (function(){
  const PILOTO = [
    "a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122", // Diego Velázquez (d.velazquez@)
  ];
  const LS = "eyg_visual";
  const SELF = (document.currentScript && document.currentScript.src) || "";
  const ASSETS = SELF.replace(/v2\.js(\?.*)?$/, "");

  function para(perfil){
    if(!perfil || !PILOTO.includes(perfil._h)) return false;
    const q = new URLSearchParams(location.search).get("visual");
    try{
      if(q==="vieja" || q==="nueva") localStorage.setItem(LS, q);
      return (localStorage.getItem(LS) || "nueva") === "nueva";
    }catch(e){ return q!=="vieja"; }
  }

  /* ---- Íconos de línea (24×24, trazo 1,6, como .eyg-r-icon del portal) ---- */
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
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    dot:'<circle cx="12" cy="12" r="3"/>',
  };
  const EMO = {
    "🏠":"home","💬":"chat","🏥":"hosp","📣":"megaf","⚡":"bolt","📊":"chart","🧮":"calc","💯":"target","🎯":"target",
    "📦":"box","💊":"pill","🔎":"search","🔍":"search","📥":"inbox","🏷":"tag","🩺":"pulse","🫀":"heart","💡":"bulb","📋":"clip",
    "🤝":"link","🔀":"merge","👥":"users","👤":"user","🗺":"map","🧠":"nodes","✨":"spark","🌐":"globe","⚙":"gear",
    "⚗":"flask","🏛":"bank","🏦":"bank","🐾":"paw","💰":"money","💳":"card","💸":"out","📁":"folder","📚":"book",
    "🧾":"receipt","🪪":"idcard","📈":"trend","📅":"cal","🗓":"cal","⚠":"alert","⛔":"alert","🏆":"trophy","🚀":"arrow",
    "📱":"phone","🤖":"bot","✍":"pen","📐":"chart","✅":"check","⏰":"clock","⏱":"clock","🕒":"clock","🚚":"truck","❔":"dot",
  };
  const svg = (k,cls="v2i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[k]||P.dot}</svg>`;
  const RX = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;
  const RX_ALL = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}‍️⃣]/gu;
  function iconoDe(txt){
    const t = (txt||"").replace(/[️‍]/g,"").trim();
    for(const ch of Array.from(t)) if(EMO[ch]) return EMO[ch];
    return RX.test(t) ? "dot" : null;
  }
  /* Deja el texto sin emojis (y sin el espacio que los separaba). */
  function limpiar(el){
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const ns=[]; while(w.nextNode()) ns.push(w.currentNode);
    ns.forEach(n=>{
      if(!RX.test(n.nodeValue)) return;
      const v = n.nodeValue.replace(RX_ALL,"").replace(/\s{2,}/g," ");
      n.nodeValue = /^\s/.test(n.nodeValue) && n.previousSibling ? v : v.replace(/^\s+/,"");
    });
  }
  /* Un casillero de ícono (sidebar, accesos, novedades): emoji → svg. */
  function iconizar(el){
    if(el.dataset.v2===el.textContent) return;
    const k = iconoDe(el.textContent);
    if(!k) return;
    el.innerHTML = svg(k);
    el.dataset.v2 = el.textContent;   // textContent de un svg es "" → sólo marca hecho
  }

  const LIMPIAR = [".mbody .dhead h1",".mbody .cx-h h2",".mbody .ktile .kl",".mbody .canleg-h",".mbody .cnl-h",
    ".mbody .big-l",".mbody .rhead",".mbody .rl",".mbody .lv .n",".mbody .evo-stats .l",".mbody .pills button",
    ".mbody .vt-l",".mbody .sest",".sfoot a",".sfoot .out",".mbody .gcta",".mbody .more",".mbody .cli-tabs button",
    ".cli-top h3",".mbody .legend span",".mbody .evo-stats .v",".mbody .cx>div:not([class])"];
  const ICONOS = [".snav .item .ic",".mbody .q .qi",".mbody .fi .fic",".mbody .vt-i"];

  function pasar(){
    document.querySelectorAll(ICONOS.join(",")).forEach(iconizar);
    document.querySelectorAll(LIMPIAR.join(",")).forEach(limpiar);
    /* marca: monograma Georgia → logo del portal + rótulo con filete */
    const sb = document.querySelector(".sbrand a");
    if(sb && !sb.querySelector(".v2logo")){
      sb.innerHTML = `<img class="v2logo" src="${ASSETS}logo-eyg.svg" alt="Droguería EyG"><span class="v2tag">Panel<b>interno</b></span>`;
    }
    const ham = document.querySelector(".mbar .ham");
    if(ham && !ham.querySelector("svg")) ham.innerHTML = svg("menu","v2i");
    /* epígrafe del encabezado, como el «kicker» del portal */
    const dh = document.querySelector(".mbody .dhead h1");
    if(dh && !dh.previousElementSibling?.classList?.contains("v2kick")){
      dh.insertAdjacentHTML("beforebegin", `<span class="v2kick">Resumen del día</span>`);
    }
  }

  let obs=null, pend=false;
  function programar(){
    if(pend) return; pend=true;
    requestAnimationFrame(()=>{ pend=false; if(obs) obs.disconnect(); try{ pasar(); } finally { observar(); } });
  }
  function observar(){
    if(!obs) obs = new MutationObserver(programar);
    obs.observe(document.body, {childList:true, subtree:true});
  }

  function on(){
    const h = document.documentElement;
    if(h.classList.contains("v2")) return;
    h.classList.add("v2");
    if(!document.getElementById("v2-fuente")){
      const pc = document.createElement("link"); pc.rel="preconnect"; pc.href="https://fonts.gstatic.com"; pc.crossOrigin="";
      const l = document.createElement("link"); l.id="v2-fuente"; l.rel="stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600&display=swap";
      document.head.append(pc, l);
    }
    observar(); programar();
  }
  return { on, para, svg, PILOTO };
})();
