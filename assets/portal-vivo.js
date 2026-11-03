/* ============ EyG Core · Portal en vivo ============
   Aviso para las comerciales: cuando una farmacia de su cartera entra al portal,
   aparece una plaquita en la esquina (con un sonido suave) y, al tocarla, una
   ventanita muestra qué está mirando en tiempo real — categorías, productos,
   búsquedas, carrito — para que la comercial pueda escribirle y asistirla.

   De dónde sale: el bloque eyg-analytics del portal anota cada paso en la tabla
   portal_evento (Supabase); la tabla está en la publicación supabase_realtime y
   el Core la escucha con postgres_changes (RLS: sólo usuarios del Core). Si el
   canal en vivo no conecta, se pregunta cada 20 s.

   A quién le aparece (lo enciende EYG.guard; ver start()):
   · por ahora sólo las comerciales del equipo Farmacias (crm.team "Farmacias y
     comercios"): cada una, las farmacias cuya cuenta la tiene como vendedora;
   · Diego y Germán: en el panel de una comercial, exactamente lo de ella; en el
     resto del Core, todo el equipo Farmacias. Se puede silenciar.
   Nunca cuenta al equipo de EyG (usuarios internos de Odoo).
   La página puede apagarlo con <body data-eyg-vivo="no"> (pantallas kiosco). */
(function(){
  if(window.EYGPortalVivo) return;
  const VENTANA_MIN = 15;      // en línea = algo en los últimos 15 minutos
  const NUEVA_VISITA_MIN = 30; // más de 30 minutos sin nada = vuelve a "entrar"
  const ST = { perfil:null, uids:null, todos:false, internos:new Set(), part:{}, cats:{},
               vivos:{}, sel:null, abierto:false, mudo:false, ultimoId:0, canal:null, audio:null, nombreYo:"" };
  const SUPERVISAN = ["diego velazquez","german banquero"];
  const norm = s=>String(s||"").normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/\s+/g," ").trim();
  const LS = k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const LSset = (k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){} };
  const esc = s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const arr = x=>Array.isArray(x)?x:[];
  /* "[AB56358] FABOGESIC NIÑOS … (Precio x unidad · Caja x 50)" → "FABOGESIC NIÑOS …" */
  const corto = s=>String(s||"").replace(/^\[[^\]]*\]\s*/,"").replace(/\s*\((precio|presentaci)[^)]*\)?\s*$/i,"").trim();
  const MENORES = new Set(["de","del","la","las","los","y","e","el","en"]);
  const titulo = s=>String(s||"").toLowerCase().split(" ").map((w,i)=>i&&MENORES.has(w)?w:w.replace(/^([(\/-]?)([a-záéíóúñü])/,(m,a,b)=>a+b.toUpperCase())).join(" ");
  /* Odoo guarda los productos EN MAYÚSCULAS: se pasan a minúscula con inicial sólo las
     palabras todas en mayúscula (las cantidades, "x", "ml" o "4%" quedan como están) */
  const lindo = s=>String(s||"").replace(/[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ.]+/g,w=>w[0]+w.slice(1).toLowerCase());
  const prod = s=>lindo(corto(s));
  const iniciales = s=>String(s||"").replace(/^(farmacia|fcia\.?)\s+/i,"").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"F";
  const hace = ms=>{ const m=Math.round((Date.now()-ms)/60000); return m<1?"recién":m===1?"hace 1 min":m<60?`hace ${m} min`:`hace ${Math.floor(m/60)} h`; };
  const hora = ms=>new Date(ms).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit",hour12:false});

  /* ---------- qué está haciendo, en palabras ---------- */
  const PAG = {inicio:["🏠","En la portada"],catalogo:["🗂️","Recorriendo el catálogo"],producto:["💊","Mirando"],categoria:["📂","Categoría"],
    carrito:["🛒","Abrió el carrito"],compra_datos:["🧾","Completando los datos de compra"],compra_pago:["💳","En el pago"],compra_confirmada:["✅","Confirmó el pedido"],
    favoritos:["⭐","Mirando sus favoritos"],mi_cuenta:["👤","En Mi cuenta"],mis_pedidos:["📦","Mirando sus pedidos"],mi_pedido:["📦","Abrió un pedido"],
    mis_facturas:["🧾","Mirando sus facturas"],mi_factura:["🧾","Abrió una factura"],mis_presupuestos:["📝","Mirando sus presupuestos"],
    vademecum:["📚","En el vademécum"],noticias:["📰","Leyendo novedades"],contacto:["☎️","En Contacto"],login:["🔑","Iniciando sesión"]};
  /* Pasos que conviene ver aunque la ventana esté cerrada: están por comprar. */
  const CALIENTE = {compra_datos:1, compra_pago:1};
  function describir(e){
    const d=e.dato||{}, t=e.tipo;
    if(t==="pagina"){
      if(d.tipo==="buscar"||d.tipo==="resultados") return null;         // lo cuenta la búsqueda
      if(d.tipo==="producto") return {ic:"💊", tx:"Mirando", fuerte:prod(d.nombre)||"un producto", clave:"p"+(d.id||d.nombre)};
      if(d.tipo==="categoria") return {ic:"📂", tx:"Categoría", fuerte:ST.cats[d.id]||(d.nombre&&d.nombre!=="Tienda"?d.nombre:"…"), cat:d.id, clave:"c"+d.id};
      const p=PAG[d.tipo]; if(!p) return null;
      return {ic:p[0], tx:p[1], caliente:!!CALIENTE[d.tipo], fin:d.tipo==="compra_confirmada", clave:"g"+d.tipo};
    }
    if(t==="busqueda"){ if(!d.q) return null;
      const sin=!+d.n && !d.candado;
      return {ic:"🔎", tx:d.tipo==="vademecum"?"Buscó en el vademécum":"Buscó", fuerte:"«"+d.q+"»", nota:sin?"sin resultados":(+d.n?`${d.n} resultado${+d.n===1?"":"s"}`:""), mala:sin, q:String(d.q).toLowerCase(), clave:"b"+String(d.q).toLowerCase()}; }
    if(t==="elegir") return {ic:"👆", tx:"Eligió", fuerte:prod(d.nombre)||"un producto", clave:"e"+d.nombre};
    if(t==="vademecum_ficha") return {ic:"📚", tx:"Vademécum", fuerte:prod(d.nombre), clave:"v"+d.nombre};
    if(t==="carrito"){
      const a=d.accion||"agregar";
      return {ic:a==="quitar"?"➖":a==="cambiar"?"✏️":"➕", tx:a==="quitar"?"Sacó del carrito":a==="cambiar"?"Cambió la cantidad de":"Agregó al carrito",
              fuerte:prod(d.producto)||"un producto", caliente:a==="agregar", clave:"k"+a+(d.id||d.producto)}; }
    if(t==="descarga") return {ic:"⬇️", tx:d.doc==="factura"?"Descargó una factura":d.doc==="pedido"?"Descargó un pedido":"Descargó un documento", clave:"d"+e.ts};
    if(t==="whatsapp") return {ic:"💬", tx:"Tocó el botón de WhatsApp", caliente:true, clave:"w"+e.ts};
    return null;
  }

  /* ---------- de quién es la farmacia ---------- */
  async function quienEs(pid){
    if(ST.part[pid]) return ST.part[pid];
    ST.part[pid]=(async()=>{
      const F=["name","commercial_partner_id","user_id","mobile","phone","city","x_studio_nombre_de_fantasia"];
      const c=arr(await EYG.rpc("res.partner","read",[[pid],F],{context:{active_test:false}}))[0]; if(!c) return null;
      let k=c; const cid=c.commercial_partner_id?c.commercial_partner_id[0]:c.id;
      if(cid!==c.id) k=arr(await EYG.rpc("res.partner","read",[[cid],F],{context:{active_test:false}}))[0]||c;
      const vend=(k.user_id||c.user_id||null);
      return { cuenta:cid, nom:k.x_studio_nombre_de_fantasia||c.x_studio_nombre_de_fantasia||corto(k.name)||"Farmacia",
               persona:cid!==c.id?c.name:"", ciudad:titulo(k.city||c.city||""), tel:c.mobile||k.mobile||c.phone||k.phone||"",
               vendId:vend?vend[0]:0, vendNom:vend?vend[1]:"" };
    })().catch(()=>null);
    return ST.part[pid];
  }
  function esMia(info){ return !!info && !!ST.uids && ST.uids.has(info.vendId); }

  /* ---------- llegada de un movimiento ---------- */
  async function llega(e, silencio){
    if(!e || !(e.partner_id>0) || ST.internos.has(e.partner_id)) return;
    if(e.id && e.id<=ST.ultimoId && !silencio) return;
    if(e.id) ST.ultimoId=Math.max(ST.ultimoId,e.id);
    const info=await quienEs(e.partner_id); if(!esMia(info)) return;
    const ts=Date.parse(e.ts)||Date.now();
    let v=ST.vivos[info.cuenta];
    const nueva=!v || ts-v.ult>NUEVA_VISITA_MIN*60000;
    if(nueva){ v=ST.vivos[info.cuenta]={info, ini:ts, ult:ts, pasos:[], nuevo:true}; }
    v.ult=Math.max(v.ult,ts);
    const d=describir(e);
    if(d){
      if(d.cat && !ST.cats[d.cat]) nombreCat(d.cat);
      d.ts=ts; d.cat=d.cat||0;
      const prev=v.pasos[0];
      /* el buscador sugiere mientras escriben: "tafi", "tafirol", "tafirol 1" es una sola búsqueda */
      if(prev && prev.q && d.q && ts-prev.ts<45000 && (d.q.startsWith(prev.q)||prev.q.startsWith(d.q))) v.pasos[0]=d;
      else if(prev && prev.clave===d.clave && ts-prev.ts<5*60000) prev.ts=ts;   // recargó la misma página
      else { v.pasos.unshift(d); if(v.pasos.length>80) v.pasos.length=80; d.recien=!silencio; }
    }
    if(silencio) return;
    if(nueva) avisar(v,"entra");
    else if(d && d.caliente) avisar(v,"caliente",d);
    pintar();
  }
  async function nombreCat(id){
    ST.cats[id]="…";
    try{ const r=arr(await EYG.rpc("product.public.category","read",[[id],["name"]]))[0]; ST.cats[id]=r?r.name:"Categoría";
      Object.values(ST.vivos).forEach(v=>v.pasos.forEach(p=>{ if(p.cat===id) p.fuerte=ST.cats[id]; })); pintar(); }catch(e){ delete ST.cats[id]; }
  }

  /* ---------- sonido: dos notas suaves que suben (y tres si está por comprar) ---------- */
  function sonar(fuerte){
    if(ST.mudo) return;
    try{
      const C=ST.audio||(ST.audio=new (window.AudioContext||window.webkitAudioContext)());
      if(C.state==="suspended") C.resume();
      const notas=fuerte?[659.25,880,1174.66]:[783.99,1174.66];
      notas.forEach((f,i)=>{
        const t=C.currentTime+i*0.11, o=C.createOscillator(), o2=C.createOscillator(), g=C.createGain();
        o.type="sine"; o.frequency.value=f; o2.type="triangle"; o2.frequency.value=f*2;
        const g2=C.createGain(); g2.gain.value=0.18;
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(C.destination);
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.07,t+0.015); g.gain.exponentialRampToValueAtTime(0.0001,t+0.55);
        o.start(t); o2.start(t); o.stop(t+0.6); o2.stop(t+0.6);
      });
    }catch(e){}
  }
  /* el navegador no deja sonar hasta que la persona toca algo en la página */
  function desbloquearAudio(){ const f=()=>{ try{ const C=ST.audio||(ST.audio=new (window.AudioContext||window.webkitAudioContext)()); C.resume(); }catch(e){} }; ["pointerdown","keydown"].forEach(ev=>document.addEventListener(ev,f,{once:true,passive:true})); }

  /* ---------- la plaquita ---------- */
  function avisar(v, tipo, d){
    sonar(tipo==="caliente");
    const pila=document.getElementById("pv-pila"); if(!pila) return;
    const i=v.info, n=document.createElement("button");
    n.type="button"; n.className="pv-toast"+(tipo==="caliente"?" hot":"");
    n.setAttribute("aria-label",`${i.nom}: ${tipo==="caliente"?d.tx:"entró al portal"}. Abrir`);
    n.innerHTML=`<span class="pv-av"><i></i>${esc(iniciales(i.nom))}</span>
      <span class="pv-tt"><b>${esc(i.nom)}</b><small>${tipo==="caliente"?`${esc(d.ic)} ${esc(d.tx)}${d.fuerte?" · "+esc(d.fuerte):""}`:`entró al portal${i.ciudad?" · "+esc(i.ciudad):""}`}</small></span>
      <span class="pv-go" aria-hidden="true">›</span><span class="pv-bar"></span>`;
    n.onclick=()=>{ cerrarToast(n); abrir(i.cuenta); };
    pila.prepend(n);
    while(pila.children.length>3) pila.lastChild.remove();
    requestAnimationFrame(()=>n.classList.add("in"));
    n._t=setTimeout(()=>cerrarToast(n), tipo==="caliente"?16000:11000);
    n.onmouseenter=()=>{ clearTimeout(n._t); n.classList.add("hold"); };
    n.onmouseleave=()=>{ n.classList.remove("hold"); n._t=setTimeout(()=>cerrarToast(n),4000); };
  }
  function cerrarToast(n){ clearTimeout(n._t); n.classList.remove("in"); n.classList.add("out"); setTimeout(()=>n.remove(),420); }

  /* ---------- el indicador y la ventanita ---------- */
  function enLinea(){ const lim=Date.now()-VENTANA_MIN*60000; return Object.values(ST.vivos).filter(v=>v.ult>=lim).sort((a,b)=>b.ult-a.ult); }
  function recientes(){ const lim=Date.now()-VENTANA_MIN*60000, lim2=Date.now()-90*60000; return Object.values(ST.vivos).filter(v=>v.ult<lim && v.ult>=lim2).sort((a,b)=>b.ult-a.ult); }
  function waLink(tel){
    let d=String(tel||"").replace(/\D/g,""); if(!d) return "";
    d=d.replace(/^0+/,""); if(!d.startsWith("54")) d="54"+d; if(!d.startsWith("549")) d="549"+d.slice(2);
    const yo=(ST.nombreYo||"").split(" ")[0];
    const txt=`Hola! ${yo?`Soy ${yo}, `:""}de Droguería EyG 👋 ¿Te puedo ayudar con tu pedido?`;
    return `https://api.whatsapp.com/send?phone=${d}&text=${encodeURIComponent(txt)}`;
  }
  function pintar(){
    const dock=document.getElementById("pv-dock"); if(!dock) return;
    const L=enLinea();
    dock.classList.toggle("on", L.length>0 || ST.abierto);
    dock.innerHTML=`<span class="pv-pulso" aria-hidden="true"></span>
      <span class="pv-avs">${L.slice(0,3).map(v=>`<span class="pv-mini">${esc(iniciales(v.info.nom))}</span>`).join("")}</span>
      <span class="pv-dt"><b>${L.length}</b> ${L.length===1?"cliente":"clientes"} en el portal</span>`;
    dock.setAttribute("aria-label",`${L.length} clientes en el portal. Abrir la ventana`);
    if(ST.abierto) pintarVentana();
  }
  function pintarVentana(){
    const w=document.getElementById("pv-win"); if(!w) return;
    const L=enLinea(), R=recientes();
    if(!ST.sel || !ST.vivos[ST.sel]) ST.sel=(L[0]||R[0]||{info:{}}).info.cuenta||null;
    const v=ST.vivos[ST.sel];
    const chip=x=>`<button type="button" class="pv-chip ${x.info.cuenta===ST.sel?"sel":""} ${x.ult<Date.now()-VENTANA_MIN*60000?"off":""}" onclick="EYGPortalVivo.ver(${x.info.cuenta})">
        <span class="pv-mini">${esc(iniciales(x.info.nom))}</span>${esc(x.info.nom)}</button>`;
    let cuerpo="";
    if(!v) cuerpo=`<div class="pv-vacio"><div class="pv-radar"><i></i><i></i><i></i></div><b>Nadie de tu cartera está en el portal ahora</b><span>Cuando una farmacia entre, te aviso con una plaquita y un sonido.</span></div>`;
    else{
      const i=v.info, vivo=v.ult>=Date.now()-VENTANA_MIN*60000, ahora=v.pasos[0];
      const wa=waLink(i.tel);
      cuerpo=`<div class="pv-cli">
          <span class="pv-av big ${vivo?"":"off"}"><i></i>${esc(iniciales(i.nom))}</span>
          <div class="pv-cn"><b>${esc(i.nom)}</b><small>${esc([i.persona,i.ciudad].filter(Boolean).join(" · "))}</small>
            <small class="pv-est ${vivo?"vivo":""}">${vivo?`En el portal · entró ${hace(v.ini)}`:`Se fue ${hace(v.ult)}`}${ST.todos&&i.vendNom?` · ${esc(i.vendNom)}`:""}</small></div></div>
        ${ahora?`<div class="pv-ahora ${ahora.caliente?"hot":""}"><span class="pv-ic">${ahora.ic}</span><div><small>${vivo?"Ahora":"Lo último"}</small><b>${esc(ahora.tx)}${ahora.fuerte?`: <em>${esc(ahora.fuerte)}</em>`:""}</b>${ahora.nota?`<small class="${ahora.mala?"mala":""}">${esc(ahora.nota)}</small>`:""}</div></div>`:""}
        <div class="pv-acc">
          ${wa?`<a class="pv-btn wa" href="${wa}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z"/></svg>Escribirle</a>`:""}
          ${i.tel?`<a class="pv-btn" href="tel:${esc(String(i.tel).replace(/[^\d+]/g,""))}">📞 Llamar</a>`:`<span class="pv-btn dis">Sin teléfono cargado</span>`}
        </div>
        <div class="pv-rec"><h4>Recorrido</h4>
          <ol>${v.pasos.slice(ahora?1:0,40).map(p=>`<li class="${p.recien?"nuevo":""} ${p.caliente?"hot":""}"><span class="pv-ic">${p.ic}</span><span class="pv-pt">${esc(p.tx)}${p.fuerte?`: <em>${esc(p.fuerte)}</em>`:""}${p.nota?` <small class="${p.mala?"mala":""}">· ${esc(p.nota)}</small>`:""}</span><time>${hora(p.ts)}</time></li>`).join("")||'<li class="pv-nada">Recién llega: todavía no abrió nada más.</li>'}</ol></div>`;
      v.pasos.forEach(p=>p.recien=false);
    }
    w.querySelector(".pv-body").innerHTML=
      (L.length||R.length?`<div class="pv-chips">${L.map(chip).join("")}${R.length?`<span class="pv-sep">Hace un rato</span>${R.map(chip).join("")}`:""}</div>`:"")+cuerpo;
    w.querySelector(".pv-alc").textContent=ST.alcance||"";
    const m=w.querySelector(".pv-mudo"); m.textContent=ST.mudo?"🔕":"🔔"; m.title=ST.mudo?"Sonido apagado: tocá para encenderlo":"Sonido encendido: tocá para silenciar";
  }
  function abrir(cuenta){ if(cuenta) ST.sel=cuenta; ST.abierto=true; const w=document.getElementById("pv-win"); w.hidden=false; requestAnimationFrame(()=>w.classList.add("in")); pintar(); }
  function cerrar(){ ST.abierto=false; const w=document.getElementById("pv-win"); w.classList.remove("in"); setTimeout(()=>{ if(!ST.abierto) w.hidden=true; },300); pintar(); }

  function montar(){
    const css=document.createElement("style"); css.id="pv-css"; css.textContent=CSS; document.head.appendChild(css);
    const raiz=document.createElement("div"); raiz.id="pv-raiz";
    raiz.innerHTML=`<div id="pv-pila" role="status" aria-live="polite"></div>
      <section id="pv-win" hidden aria-label="Portal en vivo">
        <header><span class="pv-live"><i></i>EN VIVO</span><h3>Portal EyG<small class="pv-alc"></small></h3>
          <button type="button" class="pv-mudo" onclick="EYGPortalVivo.mudo()"></button>
          <button type="button" class="pv-x" onclick="EYGPortalVivo.cerrar()" aria-label="Cerrar">×</button></header>
        <div class="pv-body"></div>
      </section>
      <button type="button" id="pv-dock" onclick="EYGPortalVivo.alternar()"></button>`;
    document.body.appendChild(raiz);
    document.addEventListener("keydown",e=>{ if(e.key==="Escape" && ST.abierto) cerrar(); });
  }

  /* ---------- arranque ---------- */
  async function start(perfil){
    if(ST.perfil || !perfil || typeof document==="undefined") return;
    if(document.body.getAttribute("data-eyg-vivo")==="no") return;
    const rol=perfil.rol, sup=EYG.esSuper&&EYG.esSuper(perfil._h);
    if(!(sup || ["admin","direccion","comercial","lider"].includes(rol))) return;
    ST.perfil=perfil; ST.mudo=LS("eyg_vivo_mudo")==="1"; ST.nombreYo=perfil.nombre||"";
    try{
      /* Por ahora sólo el equipo de Farmacias (crm.team "Farmacias y comercios"):
         cada comercial ve su cartera. Diego y Germán lo siguen de cerca: en el panel
         de una comercial (comercial/panel.html?c=…) ven exactamente lo que ve ella, y
         en el resto del Core, las carteras de todo el equipo juntas (decisión de
         Diego, 3/11/2026). El resto todavía no lo ve. */
      const eq=arr(await EYG.rpc("crm.team","search_read",[[["name","ilike","farmacia"]]],{fields:["member_ids"]}));
      const farm=new Set(eq.flatMap(t=>t.member_ids||[]));
      /* el nombre puede venir del organigrama o del enlace del panel y no ser letra por
         letra el del usuario de Odoo (tildes, segundo apellido): se compara normalizado */
      const equipo=farm.size?arr(await EYG.rpc("res.users","read",[[...farm],["name"]],{context:{active_test:false}})):[];
      const de=n=>{ const k=norm(n); return k?equipo.filter(u=>{ const m=norm(u.name); return m===k || m.startsWith(k+" ") || k.startsWith(m+" "); }).map(u=>u.id):[]; };
      const yo=(await EYG.nombreOrg(perfil).catch(()=>""))||perfil.nombre||"";
      if(SUPERVISAN.includes(norm(yo)) || SUPERVISAN.includes(norm(perfil.nombre))){
        const c=/\/comercial\/panel\.html$/i.test(location.pathname) ? new URLSearchParams(location.search).get("c") : "";
        if(c){
          const ids=de(c); if(!ids.length) return;          // panel de alguien que no es de Farmacias
          ST.uids=new Set(ids); ST.alcance="Cartera de "+c.split(" ")[0];
        } else { ST.uids=farm; ST.todos=true; ST.alcance="Equipo Farmacias"; }
      } else {
        const ids=de(yo).length?de(yo):de(perfil.nombre); if(!ids.length) return;
        ST.uids=new Set(ids);
      }
      const it=arr(await EYG.rpc("res.users","search_read",[[["share","=",false]]],{fields:["partner_id"],limit:500,context:{active_test:false}}));
      it.forEach(u=>u.partner_id&&ST.internos.add(u.partner_id[0])); ST.internos.add(4);
    }catch(e){ return; }
    montar(); desbloquearAudio();
    /* lo de los últimos 90 minutos, sin sonido, para saber quién ya está adentro */
    try{
      const desde=new Date(Date.now()-90*60000).toISOString();
      const r=await EYG.supa().from("portal_evento").select("id,ts,partner_id,tipo,dato").gt("partner_id",0).gte("ts",desde).order("ts",{ascending:true}).limit(1500);
      for(const e of arr(r.data)) await llega(e,true);
      Object.values(ST.vivos).forEach(v=>v.nuevo=false);
    }catch(e){}
    pintar();
    escuchar();
    setInterval(()=>pintar(),30000);
  }
  function escuchar(){
    let vivo=false;
    try{
      ST.canal=EYG.supa().channel("portal-vivo-"+Math.random().toString(36).slice(2,8))
        .on("postgres_changes",{event:"INSERT",schema:"public",table:"portal_evento",filter:"partner_id=gt.0"},p=>llega(p.new))
        .subscribe(s=>{ if(s==="SUBSCRIBED") vivo=true; if(s==="CHANNEL_ERROR"||s==="TIMED_OUT"||s==="CLOSED") vivo=false; });
    }catch(e){}
    /* respaldo: si el canal en vivo no está, se pregunta cada 20 s lo nuevo */
    setInterval(async()=>{
      if(vivo || document.hidden) return;
      try{ const r=await EYG.supa().from("portal_evento").select("id,ts,partner_id,tipo,dato").gt("partner_id",0).gt("id",ST.ultimoId).order("id",{ascending:true}).limit(200);
        for(const e of arr(r.data)) await llega(e); }catch(e){}
    },20000);
  }

  window.EYGPortalVivo={ start,
    ver:c=>{ ST.sel=c; pintarVentana(); },
    alternar:()=>ST.abierto?cerrar():abrir(),
    cerrar, mudo:()=>{ ST.mudo=!ST.mudo; LSset("eyg_vivo_mudo",ST.mudo?"1":"0"); if(!ST.mudo) sonar(false); pintarVentana(); },
    _st:ST, _llega:llega };

  const CSS=`
#pv-raiz{--pv-teal:#048782;--pv-deep:#04635F;--pv-ink:#0E1F1D;--pv-agua:#E2F1EF;--pv-line:#DCE8E6;--pv-gris:#5F716E;--pv-gris2:#8A9A97;--pv-coral:#EC8B5E;--pv-ok:#1E7D46;
  position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:'Archivo',system-ui,sans-serif;pointer-events:none}
#pv-raiz>*{pointer-events:auto}
#pv-pila{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.pv-toast{position:relative;display:flex;align-items:center;gap:11px;width:300px;max-width:calc(100vw - 36px);padding:11px 14px 13px 11px;border:1px solid var(--pv-line);border-radius:16px;
  background:#fff;color:var(--pv-ink);text-align:left;cursor:pointer;overflow:hidden;font:inherit;
  box-shadow:0 2px 4px rgba(6,65,62,.06),0 14px 40px rgba(6,65,62,.18);transform:translateX(120%) scale(.96);opacity:0;
  transition:transform .55s cubic-bezier(.2,1.3,.4,1),opacity .3s,box-shadow .2s}
.pv-toast.in{transform:none;opacity:1}
.pv-toast.out{transform:translateX(60%) scale(.96);opacity:0;transition:transform .4s ease-in,opacity .35s}
.pv-toast:hover{box-shadow:0 2px 4px rgba(6,65,62,.08),0 18px 46px rgba(6,65,62,.24)}
.pv-toast:focus-visible{outline:3px solid var(--pv-teal);outline-offset:2px}
.pv-toast.hot{border-color:#F3C7AE}
.pv-av{position:relative;flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--pv-teal),var(--pv-deep));color:#fff;font-weight:800;font-size:14px;letter-spacing:.3px}
.pv-av i{position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--pv-teal);opacity:0;animation:pv-anillo 2s ease-out infinite}
.pv-toast.hot .pv-av{background:linear-gradient(135deg,#F09A6C,#D9683A)} .pv-toast.hot .pv-av i{border-color:var(--pv-coral)}
.pv-av.off{background:#B9C7C4} .pv-av.off i{display:none}
.pv-av.big{width:48px;height:48px;font-size:16px}
@keyframes pv-anillo{0%{transform:scale(.85);opacity:.7}100%{transform:scale(1.35);opacity:0}}
.pv-tt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pv-tt b{font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-tt small{font-size:12px;color:var(--pv-gris);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-go{flex:none;font-size:22px;line-height:1;color:var(--pv-teal);transition:transform .2s}
.pv-toast:hover .pv-go{transform:translateX(3px)}
.pv-bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--pv-teal);transform-origin:left;animation:pv-tiempo 11s linear forwards}
.pv-toast.hot .pv-bar{background:var(--pv-coral);animation-duration:16s}
.pv-toast.hold .pv-bar{animation-play-state:paused}
@keyframes pv-tiempo{from{transform:scaleX(1)}to{transform:scaleX(0)}}
#pv-dock{display:flex;align-items:center;gap:9px;padding:8px 14px 8px 10px;border:0;border-radius:999px;background:var(--pv-deep);color:#fff;font:inherit;font-size:13px;cursor:pointer;
  box-shadow:0 10px 28px rgba(4,99,95,.32);transform:translateY(16px) scale(.9);opacity:0;pointer-events:none;transition:transform .45s cubic-bezier(.2,1.3,.4,1),opacity .3s}
#pv-dock.on{transform:none;opacity:1;pointer-events:auto}
#pv-dock:hover{background:var(--pv-teal)} #pv-dock:focus-visible{outline:3px solid #5FC8BF;outline-offset:3px}
.pv-pulso{width:9px;height:9px;border-radius:50%;background:#7BE0B0;box-shadow:0 0 0 0 rgba(123,224,176,.7);animation:pv-late 1.8s infinite}
@keyframes pv-late{0%{box-shadow:0 0 0 0 rgba(123,224,176,.6)}70%{box-shadow:0 0 0 9px rgba(123,224,176,0)}100%{box-shadow:0 0 0 0 rgba(123,224,176,0)}}
.pv-avs{display:flex} .pv-avs .pv-mini{margin-left:-7px;border:2px solid var(--pv-deep)} .pv-avs .pv-mini:first-child{margin-left:0}
.pv-mini{display:inline-grid;place-items:center;flex:none;width:24px;height:24px;border-radius:50%;background:var(--pv-agua);color:var(--pv-deep);font-size:10px;font-weight:800}
.pv-dt b{font-weight:800}
#pv-win{width:380px;max-width:calc(100vw - 36px);max-height:min(640px,calc(100vh - 110px));display:flex;flex-direction:column;background:#fff;border:1px solid var(--pv-line);border-radius:18px;overflow:hidden;
  box-shadow:0 4px 8px rgba(6,65,62,.06),0 24px 60px rgba(6,65,62,.22);transform-origin:bottom right;transform:translateY(14px) scale(.94);opacity:0;transition:transform .4s cubic-bezier(.2,1.2,.4,1),opacity .25s}
#pv-win.in{transform:none;opacity:1}
#pv-win header{display:flex;align-items:center;gap:10px;padding:13px 12px 13px 16px;background:linear-gradient(120deg,var(--pv-deep),var(--pv-teal));color:#fff}
#pv-win h3{flex:1;margin:0;font-size:15px;font-weight:800;letter-spacing:.2px;display:flex;flex-direction:column;line-height:1.15}
#pv-win h3 .pv-alc{font-size:11px;font-weight:600;opacity:.8;letter-spacing:.2px} #pv-win h3 .pv-alc:empty{display:none}
.pv-live{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:800;letter-spacing:1.4px;background:rgba(255,255,255,.16);border-radius:999px;padding:4px 9px}
.pv-live i{width:7px;height:7px;border-radius:50%;background:#7BE0B0;animation:pv-late 1.8s infinite}
.pv-mudo,.pv-x{border:0;background:rgba(255,255,255,.14);color:#fff;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:15px;line-height:1;font-family:inherit}
.pv-x{font-size:20px} .pv-mudo:hover,.pv-x:hover{background:rgba(255,255,255,.26)}
.pv-body{overflow:auto;padding:12px 14px 14px;overscroll-behavior:contain}
.pv-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;margin-bottom:4px;border-bottom:1px solid var(--pv-line);scrollbar-width:thin}
.pv-chip{display:inline-flex;align-items:center;gap:6px;flex:none;border:1px solid var(--pv-line);background:#fff;border-radius:999px;padding:3px 10px 3px 3px;font:inherit;font-size:12px;font-weight:700;color:var(--pv-ink);cursor:pointer;white-space:nowrap}
.pv-chip.sel{border-color:var(--pv-teal);background:var(--pv-agua)} .pv-chip.off{color:var(--pv-gris2)} .pv-chip.off .pv-mini{background:#EEF2F1;color:var(--pv-gris2)}
.pv-sep{flex:none;align-self:center;font-size:10.5px;color:var(--pv-gris2);font-weight:700;text-transform:uppercase;letter-spacing:.6px;padding:0 2px 0 6px}
.pv-cli{display:flex;align-items:center;gap:12px;padding:10px 2px 12px}
.pv-cn{min-width:0;display:flex;flex-direction:column;gap:1px}
.pv-cn b{font-size:16px;font-weight:800;line-height:1.2}
.pv-cn small{font-size:12px;color:var(--pv-gris)}
.pv-est{color:var(--pv-gris2)!important} .pv-est.vivo{color:var(--pv-ok)!important;font-weight:700}
.pv-ahora{display:flex;gap:11px;align-items:flex-start;padding:12px 13px;border-radius:13px;background:var(--pv-agua);border:1px solid #CBE6E2;animation:pv-entra .45s cubic-bezier(.2,1.2,.4,1)}
.pv-ahora.hot{background:#FDF0E8;border-color:#F3C7AE}
.pv-ahora small{display:block;font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--pv-deep);margin-bottom:2px}
.pv-ahora.hot small{color:#B4501C}
.pv-ahora b{display:block;font-size:14px;font-weight:600;line-height:1.35} .pv-ahora em{font-style:normal;font-weight:800}
.pv-ahora small.mala,.pv-rec small.mala{color:#B0413E;text-transform:none;letter-spacing:0;font-weight:700}
.pv-ic{flex:none;width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:#fff;font-size:15px}
.pv-acc{display:flex;gap:8px;margin:12px 0 4px}
.pv-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 10px;border-radius:11px;border:1px solid var(--pv-line);background:#fff;color:var(--pv-ink);font-size:13px;font-weight:700;text-decoration:none!important;transition:background .15s,transform .15s}
.pv-btn:hover{background:#F3F8F7;transform:translateY(-1px)}
.pv-btn.wa{background:#1FA855;border-color:#1FA855;color:#fff} .pv-btn.wa:hover{background:#178F47}
.pv-btn svg{width:16px;height:16px;fill:currentColor}
.pv-btn.dis{color:var(--pv-gris2);font-weight:600;cursor:default} .pv-btn.dis:hover{background:#fff;transform:none}
.pv-rec h4{margin:14px 0 6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--pv-gris2)}
.pv-rec ol{list-style:none;margin:0;padding:0;position:relative}
.pv-rec ol:before{content:"";position:absolute;left:13px;top:6px;bottom:6px;width:2px;background:var(--pv-line);border-radius:2px}
.pv-rec li{position:relative;display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px;color:var(--pv-ink)}
.pv-rec li .pv-ic{background:#F3F8F7;border:2px solid #fff;z-index:1;font-size:13px}
.pv-rec li.hot .pv-ic{background:#FDF0E8}
.pv-rec li.nuevo{animation:pv-entra .5s cubic-bezier(.2,1.2,.4,1)}
.pv-pt{flex:1;min-width:0;line-height:1.35} .pv-pt em{font-style:normal;font-weight:700} .pv-pt small{color:var(--pv-gris2)}
.pv-rec time{flex:none;font-size:11.5px;color:var(--pv-gris2);font-variant-numeric:tabular-nums}
.pv-nada{color:var(--pv-gris2)!important;font-size:12.5px!important;padding-left:36px!important}
@keyframes pv-entra{from{transform:translateY(-6px);opacity:0}to{transform:none;opacity:1}}
.pv-vacio{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:22px 10px 18px;color:var(--pv-gris)}
.pv-vacio b{color:var(--pv-ink);font-size:14px} .pv-vacio span{font-size:12.5px;max-width:260px}
.pv-radar{position:relative;width:54px;height:54px;margin-bottom:8px}
.pv-radar i{position:absolute;inset:0;border-radius:50%;border:2px solid var(--pv-teal);opacity:0;animation:pv-anillo 2.4s ease-out infinite}
.pv-radar i:nth-child(2){animation-delay:.8s} .pv-radar i:nth-child(3){animation-delay:1.6s}
.pv-radar:after{content:"";position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--pv-teal)}
@media (max-width:600px){#pv-raiz{right:10px;bottom:10px}}
@media (prefers-reduced-motion:reduce){#pv-raiz *{animation:none!important;transition:none!important}}
@media print{#pv-raiz{display:none}}`;
})();
