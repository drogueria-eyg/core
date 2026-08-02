/* ===== EyG Core · núcleo compartido: Odoo + helpers + login/roles + shell ===== */
window.EYG = (function(){
  const SUPABASE_URL  = "https://yxotopoklgjowcudveoj.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4b3RvcG9rbGdqb3djdWR2ZW9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0OTE3OTAsImV4cCI6MjEwMDA2Nzc5MH0.39DqIenUuRZovmgG89R_JgHco4Lg6OvmP9AgF1Hd7rQ";
  const RPC_URL = SUPABASE_URL + "/functions/v1/odoo-rpc";

  /* ---- BASE del sitio (auto-detectada desde la ubicación de core.js) ----
     Sirve para que TODOS los links internos sean absolutos desde la raíz del Core
     (ej. https://drogueriaeyg.com.ar/core/) y no rompan al navegar entre subcarpetas. */
  const SELF = (typeof document!=="undefined" && document.currentScript && document.currentScript.src) || "";
  const BASE = (typeof window!=="undefined" && window.EYG_BASE) || SELF.replace(/assets\/core\.js(\?.*)?$/,"") || "/";
  function abs(p){ if(!p||p==="#") return p||"#"; if(/^(https?:|mailto:|tel:|#)/.test(p)) return p; return BASE + String(p).replace(/^\.?\//,""); }

  let sb = null;
  function supa(){ if(!sb){ if(!window.supabase) throw new Error("supabase-js no cargó"); sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON); } return sb; }

  /* ---- Odoo (edge function odoo-rpc) ---- */
  async function rpc(model,method,args=[],kwargs={}){
    for(let i=0;i<4;i++){ try{
      const r = await fetch(RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,method,args,kwargs})});
      const j = await r.json(); if(j.error) throw new Error(typeof j.error==="string"?j.error:JSON.stringify(j.error));
      return j.result ?? j;
    }catch(e){ if(i===3) throw e; await new Promise(res=>setTimeout(res,900*(i+1))); } }
  }

  /* ---- helpers ---- */
  const money = n => "$"+Math.round(n||0).toLocaleString("es-AR");
  const esc = s => (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const hace = d => { const t=new Date(); t.setDate(t.getDate()-d); return t.toISOString().slice(0,10); };

  /* Fechas en hora de Argentina. Odoo guarda todo en UTC: si comparamos contra
     la hora del navegador, entre las 21 y las 24 los pedidos "de hoy" caen en
     el día siguiente. Siempre resolver el día/hora con estos helpers. */
  const TZ = "America/Argentina/Buenos_Aires";
  function argToday(){ return new Intl.DateTimeFormat("en-CA",{timeZone:TZ}).format(new Date()); }
  function argParts(s){
    const d = new Date(String(s).replace(" ","T")+"Z");
    const p = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(d);
    const g={}; p.forEach(x=>g[x.type]=x.value);
    const hh = (+g.hour)%24;
    return {date:`${g.year}-${g.month}-${g.day}`, hour:hh, min:+g.minute, frac:hh+(+g.minute)/60, hm:String(hh).padStart(2,"0")+":"+g.minute};
  }
  function argNowFrac(){
    const p = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
    const g={}; p.forEach(x=>g[x.type]=x.value); return ((+g.hour)%24)+(+g.minute)/60;
  }

  /* ---- Buscadores: poder escribir sin que el campo "se escape" ----
     Los módulos se dibujan con innerHTML. Si el oninput de la búsqueda dispara
     el render de un bloque que CONTIENE al propio <input>, el navegador tira ese
     input y crea uno nuevo: se pierde el foco y la posición del cursor, y a la
     segunda letra ya no se puede seguir escribiendo. Dos remedios, siempre juntos:
       · debounce  -> filtra/consulta recién cuando dejás de tipear
       · repintar  -> devuelve foco y cursor al campo después del render
     Regla para módulos nuevos: TODO campo de búsqueda lleva id, lleva su
     value="${esc(...)}" en el template, y se engancha con EYG.buscador(). */
  const BUSCA_MS = 280;

  function debounce(fn, ms){
    let t;
    const d = function(){ const args=arguments, self=this; clearTimeout(t); t=setTimeout(()=>fn.apply(self,args), ms==null?BUSCA_MS:ms); };
    d.cancel = ()=>clearTimeout(t);
    return d;
  }

  /* Corre fn() (el render) conservando foco y cursor del campo que está activo.
     Necesita que el campo tenga id: es lo único que sobrevive a un innerHTML. */
  function repintar(fn){
    const a = document.activeElement;
    const campo = !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName||"") && !!a.id;
    let ini=null, fin=null;
    if(campo){ try{ ini=a.selectionStart; fin=a.selectionEnd; }catch(e){} }
    fn();
    if(!campo) return;
    const n = document.getElementById(a.id);
    if(!n || n===a) return;                 // el render no lo tocó: no hay nada que restaurar
    try{
      n.focus({preventScroll:true});
      // setSelectionRange no existe en type=number/date/email: por eso el try
      if(ini!=null && n.setSelectionRange) n.setSelectionRange(ini, fin);
    }catch(e){}
  }

  /* Handler listo para pegar en un oninput:
       const buscar = EYG.buscador(v => { ST.q=v; render(); });
       <input id="q" value="${esc(ST.q)}" oninput="buscar(this.value)">
     Para búsquedas que pegan contra Odoo, pasar un ms más alto (350–400). */
  function buscador(aplicar, ms){
    return debounce(function(v){ repintar(()=>aplicar(v)); }, ms);
  }

  /* ---- auth ---- */
  async function session(){ const {data} = await supa().auth.getSession(); return data.session; }

  /* Huella del email. Sirve para dejar un módulo EN PRUEBAS visible sólo para
     algunas personas sin escribir sus direcciones en el repo (que es público). */
  async function huella(txt){
    try{
      const b = new TextEncoder().encode((txt||"").trim().toLowerCase());
      const h = await crypto.subtle.digest("SHA-256", b);
      return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");
    }catch(e){ return ""; }
  }

  async function perfil(){
    const s = await session(); if(!s) return null;
    const email = (s.user.email||"").toLowerCase();
    const {data} = await supa().from("core_users").select("email,nombre,rol,comercial_ref,activo,debe_cambiar_pwd").eq("email",email).maybeSingle();
    if(data) data._h = await huella(data.email || email);
    return data;
  }
  async function login(email,pwd){ return await supa().auth.signInWithPassword({email:(email||"").trim().toLowerCase(),password:pwd}); }
  async function logout(){ try{ await supa().auth.signOut(); }catch(e){} location.href=BASE; }

  /* Portón: requireAuth(rolesPermitidos, cb). [] = cualquier logueado. admin/direccion pueden todo. */
  async function requireAuth(roles, cb){
    document.body.innerHTML = '<div class="gate"><div class="spinner"></div><div>Verificando acceso…</div></div>';
    let s; try{ s = await session(); }catch(e){ showLogin(); return; }
    if(!s){ showLogin(); return; }
    const p = await perfil();
    if(!p || !p.activo){ gateMsg("🔒","Sin acceso","Tu cuenta todavía no tiene un perfil activo en el Core. Avisá al administrador.",false); return; }
    const ok = p.rol==="admin" || p.rol==="direccion" || !roles.length || roles.includes(p.rol);
    if(!ok){ gateMsg("⛔","No autorizado","Este módulo no está habilitado para tu rol ("+p.rol+").",true); return; }
    if(p.debe_cambiar_pwd){ showChangePwd({force:true}); return; }
    document.body.innerHTML = "";
    cb(p);
  }

  /* Guard para módulos con HTML propio (NO borra el body en caso OK). Devuelve el perfil o nunca resuelve (mostrando login/no-autorizado). */
  async function guard(roles, opts){
    let s; try{ s = await session(); }catch(e){ showLogin(); return new Promise(()=>{}); }
    if(!s){ showLogin(); return new Promise(()=>{}); }
    const p = await perfil();
    if(!p || !p.activo){ gateMsg("🔒","Sin acceso","Tu cuenta todavía no tiene un perfil activo en el Core. Avisá al administrador.",false); return new Promise(()=>{}); }
    // Módulo EN PRUEBAS: sólo para las huellas de email listadas (ver puedeVer)
    const pr = opts && opts.pruebas;
    if(pr && pr.length && !pr.includes(p._h)){
      gateMsg("🚧","En preparación","Este módulo todavía se está construyendo. Va a estar disponible para todo el equipo cuando esté listo.",true);
      return new Promise(()=>{});
    }
    const ok = p.rol==="admin" || p.rol==="direccion" || !roles.length || roles.includes(p.rol);
    if(!ok){ gateMsg("⛔","No autorizado","Este módulo no está habilitado para tu rol ("+p.rol+").",true); return new Promise(()=>{}); }
    if(p.debe_cambiar_pwd){ showChangePwd({force:true}); return new Promise(()=>{}); }
    return p;
  }

  function gateMsg(ic,t,d,back){
    document.body.innerHTML = `<div class="gate"><div class="big">${ic}</div><h3>${esc(t)}</h3><p>${esc(d)}</p>`+
      (back?'<div style="margin-top:16px"><a class="btn-teal" href="'+BASE+'">Ir al inicio</a></div>':"")+
      `<div style="margin-top:14px"><a href="#" onclick="EYG.logout();return false" style="font-size:13px;color:var(--gris)">Cerrar sesión</a></div></div>`;
  }

  function showLogin(){
    document.body.innerHTML = `<div class="login-scrim"><div class="login-card">
      <div class="brand"><div class="mono">E<span class="y">y</span>G</div><div class="d">DROGUERÍA</div></div>
      <h2>EyG Core</h2><div class="sub">Ingresá con tu email para continuar</div>
      <label>Email</label><input id="lg-email" type="email" autocomplete="username" placeholder="nombre@drogueriaeyg.com.ar">
      <label>Contraseña</label><input id="lg-pwd" type="password" autocomplete="current-password" placeholder="••••••••">
      <button class="btn" id="lg-btn">Entrar</button>
      <div class="msg" id="lg-msg"></div>
      <div class="hint">Panel interno de Droguería EyG · uso exclusivo del personal</div>
    </div></div>`;
    const em=document.getElementById("lg-email"), pw=document.getElementById("lg-pwd"), bt=document.getElementById("lg-btn"), ms=document.getElementById("lg-msg");
    async function go(){
      ms.className="msg"; ms.textContent="";
      if(!em.value||!pw.value){ ms.className="msg err"; ms.textContent="Completá email y contraseña."; return; }
      bt.disabled=true; bt.textContent="Entrando…";
      const {error} = await login(em.value, pw.value);
      if(error){ bt.disabled=false; bt.textContent="Entrar"; ms.className="msg err"; ms.textContent=/Invalid|credentials/i.test(error.message)?"Email o contraseña incorrectos.":error.message; return; }
      ms.className="msg ok"; ms.textContent="¡Listo!"; setTimeout(()=>location.reload(),300);
    }
    bt.onclick=go; pw.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
    em.focus();
  }

  /* Marca la fila del usuario como "ya cambió la contraseña" (función SECURITY DEFINER en la DB) */
  async function markPwdChanged(){ try{ await supa().rpc("mark_password_changed"); }catch(e){} }

  /* Cambio de contraseña. {force:true} = obligatorio en el primer ingreso (sin cancelar). Sin force = autoservicio. */
  function showChangePwd(opts){
    const force = !!(opts&&opts.force);
    document.body.innerHTML = `<div class="login-scrim"><div class="login-card">
      <div class="brand"><div class="mono">E<span class="y">y</span>G</div><div class="d">DROGUERÍA</div></div>
      <h2>${force?"Creá tu contraseña":"Cambiar contraseña"}</h2>
      <div class="sub">${force?"Por seguridad, definí una contraseña propia para continuar.":"Elegí una contraseña nueva para tu cuenta."}</div>
      <label>Nueva contraseña</label><input id="np1" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres">
      <label>Repetir contraseña</label><input id="np2" type="password" autocomplete="new-password" placeholder="Repetí la contraseña">
      <button class="btn" id="npb">Guardar contraseña</button>
      <div class="msg" id="npm"></div>
      ${force?'<div class="hint">Panel interno de Droguería EyG · uso exclusivo del personal</div>':'<div class="hint"><a href="#" id="npcancel" style="color:var(--gris)">Cancelar</a></div>'}
    </div></div>`;
    const a=document.getElementById("np1"), b=document.getElementById("np2"), bt=document.getElementById("npb"), ms=document.getElementById("npm");
    const cancel=document.getElementById("npcancel"); if(cancel) cancel.onclick=e=>{ e.preventDefault(); location.reload(); };
    async function go(){
      ms.className="msg"; ms.textContent="";
      if((a.value||"").length<8){ ms.className="msg err"; ms.textContent="La contraseña debe tener al menos 8 caracteres."; return; }
      if(a.value!==b.value){ ms.className="msg err"; ms.textContent="Las contraseñas no coinciden."; return; }
      bt.disabled=true; bt.textContent="Guardando…";
      const {error} = await supa().auth.updateUser({password:a.value});
      if(error){ bt.disabled=false; bt.textContent="Guardar contraseña"; ms.className="msg err"; ms.textContent=error.message; return; }
      await markPwdChanged();
      ms.className="msg ok"; ms.textContent="¡Contraseña actualizada!"; setTimeout(()=>location.reload(),600);
    }
    bt.onclick=go; b.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
    a.focus();
  }

  /* ---- shell ---- */
  function topbar({title, back, perfil}={}){
    return `<div class="eyg-top"><span class="mono">E<span class="y">y</span>G</span><span class="tag">Core</span>`+
      (back?`<a class="back" href="${back}">← Inicio</a>`:"")+
      (title?`<span class="back">${esc(title)}</span>`:"")+
      `<div class="who">`+
      (perfil?`<div style="text-align:right"><b>${esc(perfil.nombre||perfil.email)}</b><span class="rol">${esc(perfil.rol)}</span></div>`:"")+
      `<a href="#" onclick="EYG.showChangePwd();return false" style="font-size:12px;color:var(--gris);text-decoration:none;margin-right:6px">🔑 Contraseña</a>`+
      `<button class="out" onclick="EYG.logout()">Salir</button></div></div>`;
  }

  /* ---- registro de módulos + navegación sidebar ---- */
  const DEPTS = [
    {key:"comunicacion", nom:"Comunicación"},
    {key:"comercial", nom:"Comercial"},
    {key:"finanzas",  nom:"Finanzas"},
    {key:"inventario",nom:"Inventario"},
    {key:"datos",     nom:"Datos"},
    {key:"direccion", nom:"Dirección"},
    {key:"admin",     nom:"Sistema"},
  ];
  const MODULOS = [
    {key:"comunicaciones", dept:"comunicacion", cat:"Comunicación", ico:"📣",
      titulo:p=>(p.rol==="admin"||p.rol==="direccion"||p.rol==="lider")?"Comunicaciones":"Novedades",
      desc:p=>(p.rol==="admin"||p.rol==="direccion")?"Bajá novedades a toda la empresa o a un área y seguí quién las leyó."
             :(p.rol==="lider"?"Novedades para tu equipo y las bajadas de Gerencia, con acuse de lectura.":"Las novedades y bajadas que te llegan de Gerencia y de tu líder."),
      roles:["comercial","lider","finanzas","inventario","cobranzas","maestro"], ready:true,
      path:()=>"comunicaciones/comunicaciones.html"},
    {key:"panel", dept:"comercial", cat:"Comercial", ico:"⚡",
      titulo:p=>(p.rol==="admin"||p.rol==="direccion")?"Panel comerciales":"Mi Panel",
      desc:p=>(p.rol==="admin"||p.rol==="direccion")?"El equipo: métricas resumidas de cada comercial + acceso a su panel individual y al panel del líder.":(p.rol==="lider"?"Tu panel de líder: el equipo, cumplimiento y alertas.":"Tu sesión de venta: objetivos, comisión, salud y tu cartera a mano."),
      roles:["comercial","lider"], ready:true,
      path:p=>{ if(p.rol==="admin"||p.rol==="direccion") return "comercial/comerciales.html"; if(p.rol==="lider") return "comercial/lider.html"; return `comercial/panel.html${p&&p.comercial_ref?("?c="+encodeURIComponent(p.comercial_ref)):""}`; }},
    {key:"crm",       dept:"comercial", cat:"Comercial", ico:"👥", titulo:"CRM · Clientes", desc:"Segmentá farmacias e instituciones por frecuencia y contactá por WhatsApp.", roles:["comercial"], ready:false, path:()=>"comercial/crm.html"},
    {key:"precios",   dept:"comercial", cat:"Precios", ico:"🏷️", titulo:"Rentabilidad y Precios", desc:"Costo, escalera de precios por cantidad y margen por tramo, con salud por color.", roles:["comercial","finanzas","inventario"], ready:true, path:()=>"comercial/precios.html"},
    {key:"config-precios", dept:"comercial", cat:"Precios", ico:"⚙️", titulo:"Configuración de precios", desc:"Reglas del sincronizador por categoría: recargo, cortes, descuentos, IVA al costo y piso de margen.", roles:["comercial","finanzas"], ready:true, path:()=>"comercial/config-precios.html"},
    /* PROVISORIO: simulador de escalera de éticos A/B para revisar antes de definir. Sacar (esta línea + comercial/simulador-eticos.html) cuando se cierre. */
    {key:"sim-eticos", dept:"comercial", cat:"Precios", ico:"🧪", titulo:"Simulador Éticos (provisorio)", desc:"Prueba de la escalera A/B por laboratorio: márgenes por tramo (x1/x5/x10), filtrable por escala de margen. Módulo temporal para revisión.", roles:["direccion","finanzas","inventario"], ready:true, path:()=>"comercial/simulador-eticos.html"},
    {key:"cobranzas", dept:"finanzas", cat:"Finanzas", ico:"💳", titulo:"Cobranzas", desc:"Deuda por cliente con antigüedad (+30/+60/+90/+120) para reclamar y detectar incobrables.", roles:["finanzas","cobranzas"], ready:true, path:()=>"finanzas/cobranzas.html"},
    {key:"stock",     dept:"inventario", cat:"Inventario", ico:"📦", titulo:"Stock y Sobrestock", desc:"Plata inmovilizada, rotación por producto y vencimientos. Qué frenar y qué liquidar.", roles:["finanzas","inventario"], ready:true, path:()=>"inventario/stock.html"},
    {key:"nombres",   dept:"inventario", cat:"Inventario", ico:"🏷️", titulo:"Maestro de productos", desc:"Ordená el dato maestro de cada producto: nombre, unidades, embalaje y subcategoría. Detecta errores y completa lo que falta, con un clic.", roles:["inventario","maestro"], ready:true, path:()=>"inventario/nombres.html"},
    {key:"oportunidades", dept:"inventario", cat:"Inventario", ico:"💡", titulo:"Oportunidades y Ofertas", desc:"Cuando un costo baja, el sistema detecta una oportunidad de oferta. Confirmala (precio, stock, vigencia) o armá combos, y van a la tarjeta de los comerciales.", roles:["inventario"], ready:true, path:()=>"inventario/oportunidades.html"},
    {key:"contactos", dept:"datos", cat:"Datos", ico:"🗂️", titulo:"Contactos", desc:"Calidad de datos (teléfono, email, condición fiscal), duplicados y ventas por comercial.", roles:["comercial","admin"], ready:false, path:()=>"datos/contactos.html"},
    /* EN PRUEBAS: oculto para todo el equipo hasta terminarlo. `pruebas` son
       huellas (SHA-256) de email — así no publicamos direcciones en el repo.
       Para liberarlo a todos: borrar la línea `pruebas` de acá y el {pruebas:…}
       del EYG.guard() de direccion/tablero.html. */
    {key:"tablero", dept:"direccion", cat:"Dirección", ico:"🗺️", titulo:"Tablero en vivo", desc:"Mapa con nuestras farmacias e instituciones, clientes activos y nuevos en tiempo real, cobertura por zona y cuánto mercado falta conquistar. Pensado para pantalla grande.", roles:["comercial","finanzas","inventario"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"direccion/tablero.html"},
    {key:"radiografia",dept:"direccion", cat:"Dirección", ico:"📊", titulo:"Radiografía", desc:"Ventas, facturación, márgenes, cobranza y stock de toda la droguería en un tablero.", roles:["direccion"], ready:false, path:()=>"direccion/radiografia.html"},
    {key:"usuarios",  dept:"admin", cat:"Sistema", ico:"👤", titulo:"Usuarios y accesos", desc:"Altas de personal, roles y qué módulo puede ver cada uno.", roles:["admin"], ready:false, path:()=>"admin/usuarios.html"},
  ];
  /* Acepta el perfil entero (o sólo el rol, por compatibilidad).
     `pruebas` = lista de huellas de email: mientras esté puesta, el módulo NO
     aparece para nadie más, ni siquiera para admin/dirección. */
  function puedeVer(m, perfilORol){
    const p = (typeof perfilORol === "string") ? {rol:perfilORol} : (perfilORol||{});
    if(m.pruebas && m.pruebas.length && !m.pruebas.includes(p._h)) return false;
    return p.rol==="admin"||p.rol==="direccion" ? true : m.roles.includes(p.rol);
  }
  function T(v,p){ return typeof v==="function" ? v(p) : v; }  // título/desc pueden depender del rol

  function sidebar(perfil, activeKey){
    const vis = MODULOS.filter(m=>puedeVer(m,perfil));
    const grupos = DEPTS.map(d=>({d, mods:vis.filter(m=>m.dept===d.key)})).filter(x=>x.mods.length);
    return `<aside class="side" id="eygSide">
      <div class="sbrand"><a href="${BASE}"><span class="mono">E<span class="y">y</span>G</span><span class="ctag">Core</span></a></div>
      <nav class="snav">
        <a class="item ${activeKey==="home"?"active":""}" href="${BASE}"><span class="ic">🏠</span>Inicio</a>
        ${grupos.map(({d,mods})=>`<div class="grp">${d.nom}</div>`+mods.map(m=>{
          const dis=!m.ready; const href=dis?"#":abs(m.path(perfil));
          return `<a class="item ${activeKey===m.key?"active":""} ${dis?"dis":""}" href="${href}" ${dis?'onclick="return false"':""}><span class="ic">${m.ico}</span><span class="tx">${esc(T(m.titulo,perfil))}</span>${dis?'<span class="soon">pronto</span>':""}</a>`;
        }).join("")).join("")}
      </nav>
      <div class="sfoot"><div class="u"><b>${esc(perfil.nombre||perfil.email)}</b><span>${esc(perfil.rol)}</span></div><a href="#" onclick="EYG.showChangePwd();return false" style="display:block;font-size:12px;color:var(--gris);text-decoration:none;margin:2px 0 8px">🔑 Cambiar contraseña</a><button class="out" onclick="EYG.logout()">Salir ↪</button></div>
    </aside>`;
  }
  function layout(perfil, activeKey, main, pageTitle){
    const mod = MODULOS.find(m=>m.key===activeKey);
    const title = pageTitle || (mod?mod.titulo:"Inicio");
    return `<div class="app">${sidebar(perfil,activeKey)}<main class="main"><div class="mbar"><button class="ham" onclick="document.getElementById('eygSide').classList.toggle('open')">☰</button><h1>${esc(title)}</h1></div><div class="mbody">${main}</div></main><div class="side-scrim" onclick="document.getElementById('eygSide').classList.remove('open')"></div></div>`;
  }
  function homeMain(perfil){
    const vis = MODULOS.filter(m=>puedeVer(m,perfil));
    const grupos = DEPTS.map(d=>({d, mods:vis.filter(m=>m.dept===d.key)})).filter(x=>x.mods.length);
    const nombre = (perfil.nombre||perfil.email||"").split(" ")[0];
    return `<div class="hero"><h1>Hola, ${esc(nombre)} 👋</h1><p>Tus herramientas de Droguería EyG, conectadas en vivo a Odoo. Elegí un módulo del menú o de las tarjetas.</p></div>
      ${grupos.map(({d,mods})=>`<div class="dept"><h2>${d.nom}</h2><div class="grid">${mods.map(m=>{
        const dis=!m.ready; const href=dis?"#":abs(m.path(perfil));
        const badge=dis?'<span class="badge soon">Próximamente</span>':'<span class="badge ready">Abrir</span>';
        const inner=`${badge}<div class="ico">${m.ico}</div><div class="cat">${esc(T(m.cat,perfil))}</div><h3>${esc(T(m.titulo,perfil))}</h3><p>${esc(T(m.desc,perfil))}</p>`;
        return dis?`<div class="card soon">${inner}</div>`:`<a class="card" href="${href}">${inner}</a>`;
      }).join("")}</div></div>`).join("")}`;
  }

  /* ---- Tarjeta "Combos y ofertas de la semana" (compartida: panel comercial + lider) ----
     Lee las ofertas activas del parametro eyg.ofertas (las carga el modulo Oportunidades). */
  async function cardOfertasSemana(elId){
    const el = document.getElementById(elId); if(!el) return;
    let ofertas=[];
    try{ const raw = await rpc("ir.config_parameter","get_param",["eyg.ofertas"]); ofertas = JSON.parse(raw||"[]"); }catch(e){ return; }
    const hoy = new Date().toISOString().slice(0,10);
    const act = ofertas.filter(o=>!o.hasta || o.hasta>=hoy);
    if(!act.length){ el.innerHTML=""; return; }
    const fD=s=>s?(s.slice(8,10)+"/"+s.slice(5,7)):"";
    const card=o=>{
      const items=(o.items||[]).map(i=>i.nombre).join(" + ");
      const ah = (o.precioAntes>o.precio) ? Math.round((1-o.precio/o.precioAntes)*100) : 0;
      return `<div style="background:#fff;border-radius:12px;padding:12px 13px;min-width:210px;flex:1 1 210px;box-shadow:0 2px 10px rgba(0,0,0,.08)">
        <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#048782">${o.tipo==='combo'?'🎁 Combo':'🏷️ Oferta'}${o.hasta?' · hasta '+fD(o.hasta):''}</div>
        <div style="font-weight:800;font-size:14px;color:#0E1F1D;margin:3px 0;line-height:1.25">${esc(o.titulo||items)}</div>
        ${(o.titulo&&items&&items!==o.titulo)?`<div style="font-size:11px;color:#8A9A97">${esc(items)}</div>`:""}
        <div style="display:flex;align-items:baseline;gap:7px;margin-top:6px">
          ${o.precioAntes>o.precio?`<span style="color:#8A9A97;text-decoration:line-through;font-size:12px">${money(o.precioAntes)}</span>`:""}
          <span style="color:#1E7D46;font-weight:900;font-size:18px">${money(o.precio)}</span>
          ${ah?`<span style="background:#e7f6ec;color:#1E7D46;font-weight:800;font-size:11px;border-radius:20px;padding:1px 7px">−${ah}%</span>`:""}
        </div>
        ${o.stock?`<div style="font-size:11px;color:#5F716E;margin-top:4px">📦 ${o.stock} disponibles</div>`:""}
        ${o.nota?`<div style="font-size:11px;color:#5F716E;margin-top:2px">📝 ${esc(o.nota)}</div>`:""}
      </div>`;
    };
    el.innerHTML = `<div style="background:linear-gradient(135deg,#04635F,#048782);border-radius:16px;padding:15px 16px;margin:14px 0">
      <div style="color:#fff;font-weight:800;font-size:16px;margin-bottom:11px">🏷️ Combos y ofertas de la semana <span style="opacity:.8;font-weight:600;font-size:12px">· ${act.length}</span></div>
      <div style="display:flex;gap:11px;flex-wrap:wrap">${act.map(card).join("")}</div>
    </div>`;
  }

  /* ===== Comunicaciones · novedades internas (parámetro eyg.comunicaciones) =====
     Molde igual al de las ofertas: un array JSON en ir.config_parameter que escribe
     el módulo "Comunicaciones" y leen las tarjetas de los paneles. Cada novedad se
     dirige por `alcance`: 'todos' (empresa), 'departamento' (áreas elegidas) o
     'equipo' (los comerciales de un líder, guardados como `destinatarios`). El acuse
     de lectura vive en `leidoPor` (para el reporte al emisor). */
  const COM_KEY = "eyg.comunicaciones";
  const COM_DEPTS = [
    {key:"comercial", nom:"Comercial"},
    {key:"finanzas",  nom:"Finanzas"},
    {key:"inventario",nom:"Inventario"},
    {key:"direccion", nom:"Dirección"},
  ];
  /* Departamento al que pertenece cada rol (para saber qué bajadas le tocan). */
  function comDeptDeRol(rol){
    return ({comercial:"comercial", lider:"comercial", finanzas:"finanzas", cobranzas:"finanzas",
             inventario:"inventario", maestro:"inventario", direccion:"direccion", admin:"direccion"})[rol] || rol;
  }
  async function comsLeer(){
    try{ return JSON.parse(await rpc("ir.config_parameter","get_param",[COM_KEY])||"[]")||[]; }catch(e){ return []; }
  }
  async function comsGuardar(arr){ return rpc("ir.config_parameter","set_param",[COM_KEY, JSON.stringify(arr)]); }

  /* Novedades vigentes dirigidas a este perfil. admin/dirección ven todas (supervisión). */
  function comsParaMi(perfil, arr){
    const hoy = argToday(), dept = comDeptDeRol(perfil.rol), ref = perfil.comercial_ref || "";
    const manda = perfil.rol==="admin" || perfil.rol==="direccion";
    return (arr||[]).filter(c=>{
      if(!c || c.activo===false) return false;
      if(c.clase && c.clase!=="novedad") return false;           // fase 1: sólo novedades
      if(c.desde && c.desde>hoy) return false;
      if(c.hasta && c.hasta<hoy) return false;
      if(manda) return true;
      if(c.alcance==="todos") return true;
      if(c.alcance==="departamento") return (c.departamentos||[]).includes(dept);
      if(c.alcance==="equipo") return (c.destinatarios||[]).includes(ref);
      return false;
    });
  }
  function comLeida(c, email){ return (c.leidoPor||[]).some(x=>x.email===(email||"").toLowerCase()); }

  /* Marca una novedad como leída (read-modify-write; relee justo antes para no pisar
     acuses de otros). El reporte del emisor se arma con estos leidoPor. */
  async function comMarcarLeido(perfil, id){
    const email=(perfil.email||"").toLowerCase();
    const arr=await comsLeer(); const c=arr.find(x=>x.id===id); if(!c) return;
    c.leidoPor=c.leidoPor||[];
    if(c.leidoPor.some(x=>x.email===email)) return;
    c.leidoPor.push({email, nombre:perfil.nombre||email, ts:new Date().toISOString()});
    await comsGuardar(arr);
  }

  /* ===== Mensajes de WhatsApp a clientes (clase 'wa') =====
     Van DIRECTO al panel de los comerciales para que los disparen a su cartera (sin aprobación
     del líder). origen 'gerencia' llega a todos los comerciales; origen 'lider' sólo a su equipo
     (destinatarios). Cada tarjeta muestra quién lo creó (autor). El envío a cada cliente se mide
     con una nota [EyGWA] campana/<id> en el partner (ver waMarker). */
  function _comVig(c,hoy){ return (!c.desde||c.desde<=hoy) && (!c.hasta||c.hasta>=hoy); }
  /* Mensajes WA que este comercial puede enviar a su cartera. */
  function wasParaComercial(perfil, arr){
    const hoy=argToday(), ref=perfil.comercial_ref||"";
    return (arr||[]).filter(c=>c && c.clase==="wa" && c.activo!==false && _comVig(c,hoy) && (c.origen==="gerencia" || (c.destinatarios||[]).includes(ref)))
      .sort((a,b)=>String(b.ts||"").localeCompare(String(a.ts||"")));
  }
  function comVistoWA(c, email){ return (c.vistoPor||[]).includes((email||"").toLowerCase()); }
  /* Marca WA como "visto" por el comercial (para apagar el aviso de la campana). RMW. */
  async function comMarcarVistoWA(perfil, ids){
    const email=(perfil.email||"").toLowerCase(), set=new Set(ids||[]);
    if(!set.size) return;
    const arr=await comsLeer(); let ch=false;
    arr.forEach(c=>{ if(set.has(c.id)){ c.vistoPor=c.vistoPor||[]; if(!c.vistoPor.includes(email)){ c.vistoPor.push(email); ch=true; } } });
    if(ch) await comsGuardar(arr);
  }
  /* Marcador de la nota que se postea en el partner cuando el comercial envía la campaña.
     Cuenta como contacto [EyGWA] (suma a la meta diaria) y permite medir alcance por mensaje. */
  const waMarker = id => "[EyGWA] campana/"+id;

  /* ===== Campana de novedades (ícono para el header de los paneles) =====
     Reemplaza a la tarjeta grande: un ícono 🔔 con badge de no leídas y un
     desplegable con las novedades. COM_CTX guarda el perfil por punto de montaje.
     (Fase 2: la misma campana avisará de mensajes de WhatsApp nuevos.) */
  const COM_CTX = {};   // mountId -> {perfil, opts}
  let _bellOpen = null;
  function comBellStyles(){
    if(typeof document==="undefined" || document.getElementById("eyg-bell-css")) return;
    const s=document.createElement("style"); s.id="eyg-bell-css";
    s.textContent=`
    .eyg-bell-wrap{position:relative;display:inline-flex}
    .eyg-bell-btn{background:transparent;border:0;color:inherit;cursor:pointer;font-size:20px;line-height:1;padding:5px;border-radius:10px;position:relative;display:inline-flex;align-items:center;justify-content:center}
    .eyg-bell-btn:hover{background:rgba(127,127,127,.16)}
    .eyg-bell-badge{position:absolute;top:-1px;right:-1px;min-width:16px;height:16px;padding:0 4px;background:#EC5E4F;color:#fff;font-size:10px;font-weight:800;border-radius:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px rgba(0,0,0,.12)}
    .eyg-bell-dd{position:absolute;right:0;top:calc(100% + 8px);width:344px;max-width:88vw;max-height:66vh;overflow:auto;background:#fff;border:1px solid #e5eae9;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.24);z-index:9999;padding:8px;text-align:left}
    .eyg-bell-dd .hd{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 8px;border-bottom:1px solid #eef1f0;margin-bottom:4px}
    .eyg-bell-dd .hd b{font-size:14px;color:#0E1F1D}
    .eyg-bell-dd .allread{background:none;border:0;color:#048782;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;padding:0}
    .eyg-wa-banner{display:flex;align-items:center;gap:7px;background:#e7f7ee;border:1px solid #bfe6cc;color:#1b6b3e;border-radius:10px;padding:9px 11px;font-size:12.5px;font-weight:600;cursor:pointer;margin-bottom:6px}
    .eyg-wa-banner b{color:#12592f} .eyg-wa-banner .go{margin-left:auto;color:#1E7D46;font-weight:800;white-space:nowrap}
    .eyg-nov{padding:9px 8px;border-radius:10px}
    .eyg-nov + .eyg-nov{border-top:1px solid #f0f3f2}
    .eyg-nov.unread{background:#f2fbfa}
    .eyg-nov .t{font-weight:800;font-size:13.5px;color:#0E1F1D;display:flex;align-items:center;gap:6px;line-height:1.25}
    .eyg-nov .dot{width:7px;height:7px;border-radius:50%;background:#048782;flex:none}
    .eyg-nov .bd{font-size:12.5px;color:#3a4a47;white-space:pre-wrap;line-height:1.4;margin-top:3px}
    .eyg-nov .mt{font-size:11px;color:#8A9A97;margin-top:6px;display:flex;justify-content:space-between;gap:8px;align-items:center}
    .eyg-nov .mk{background:#04635F;color:#fff;border:0;border-radius:7px;padding:4px 10px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}
    .eyg-bell-empty{padding:22px 12px;text-align:center;color:#8A9A97;font-size:13px}
    .eyg-bell-alta{background:#fbe4e3;color:#b0322f;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;border-radius:20px;padding:1px 7px}
    @keyframes eygWaFlash{0%{box-shadow:0 0 0 0 rgba(30,125,70,.55)}100%{box-shadow:0 0 0 10px rgba(30,125,70,0)}}
    .eyg-wa-flash{animation:eygWaFlash 1.2s ease-out 1;border-radius:16px}`;
    document.head.appendChild(s);
  }
  function comCerrarBells(){ if(typeof document==="undefined") return; document.querySelectorAll(".eyg-bell-dd").forEach(d=>d.style.display="none"); _bellOpen=null; }
  if(typeof document!=="undefined"){ document.addEventListener("click",e=>{ if(!(e.target.closest && e.target.closest(".eyg-bell-wrap"))) comCerrarBells(); }); }

  /* Monta/re-pinta la campana en el elemento `mountId`. Idempotente: llamala cada vez.
     opts.wa=true agrega el aviso de mensajes de WhatsApp para enviar; opts.waTarget = id del
     bloque de la sección WhatsApp al que hace scroll el botón "Ver". */
  async function bellComunicaciones(mountId, perfil, opts){
    const mount=document.getElementById(mountId); if(!mount||!perfil) return;
    opts=opts||{}; comBellStyles(); COM_CTX[mountId]={perfil, opts};
    let arr; try{ arr=await comsLeer(); }catch(e){ arr=[]; }
    const email=(perfil.email||"").toLowerCase();
    const mine=comsParaMi(perfil,arr).sort((a,b)=>{ const la=comLeida(a,email),lb=comLeida(b,email); if(la!==lb) return la?1:-1; return ((b.prioridad==="alta")-(a.prioridad==="alta"))||String(b.ts||"").localeCompare(String(a.ts||"")); });
    const nUnread=mine.filter(c=>!comLeida(c,email)).length;
    const waNuevos = opts.wa ? wasParaComercial(perfil,arr).filter(c=>!comVistoWA(c,email)) : [];
    const nBadge = nUnread + waNuevos.length;
    const fD=s=>s?(String(s).slice(8,10)+"/"+String(s).slice(5,7)):"";
    const abierto=_bellOpen===mountId;
    const item=c=>{ const leida=comLeida(c,email);
      return `<div class="eyg-nov ${leida?'':'unread'}">
        <div class="t">${!leida?'<span class="dot"></span>':''}${c.prioridad==="alta"?'<span class="eyg-bell-alta">Importante</span>':''}${esc(c.titulo||"")}</div>
        <div class="bd">${esc(c.cuerpo||"")}</div>
        <div class="mt"><span>${esc(c.autor||"")}${c.ts?" · "+fD(c.ts.slice(0,10)):""}</span>${leida?'<span>✓ leído</span>':`<button class="mk" onclick="EYG.comMarcarYRepintar('${mountId}','${c.id}')">Leído</button>`}</div>
      </div>`;
    };
    const waBanner = waNuevos.length ? `<div class="eyg-wa-banner" onclick="EYG.comVerWA('${mountId}')">📱 <span><b>${waNuevos.length}</b> mensaje${waNuevos.length>1?'s':''} de WhatsApp para enviar a tus clientes</span><span class="go">Ver ↓</span></div>` : '';
    mount.innerHTML=`<div class="eyg-bell-wrap">
      <button class="eyg-bell-btn" title="Novedades" onclick="EYG.comToggleBell(event,'${mountId}')">🔔${nBadge?`<span class="eyg-bell-badge">${nBadge>9?'9+':nBadge}</span>`:''}</button>
      <div class="eyg-bell-dd" style="display:${abierto?'block':'none'}">
        ${waBanner}
        <div class="hd"><b>📣 Novedades</b>${nUnread?`<button class="allread" onclick="EYG.comMarcarTodas('${mountId}')">Marcar todas leídas</button>`:''}</div>
        ${mine.length?mine.map(item).join(""):'<div class="eyg-bell-empty">No tenés novedades por ahora.</div>'}
      </div>
    </div>`;
  }
  function comToggleBell(ev, mountId){
    if(ev){ ev.stopPropagation(); }
    const mount=document.getElementById(mountId); const dd=mount&&mount.querySelector(".eyg-bell-dd"); if(!dd) return;
    const abrir = dd.style.display==="none";
    comCerrarBells();
    if(abrir){ dd.style.display="block"; _bellOpen=mountId; }
  }
  async function comMarcarYRepintar(mountId, id){ const cx=COM_CTX[mountId]; if(!cx) return; _bellOpen=mountId; await comMarcarLeido(cx.perfil,id); await bellComunicaciones(mountId,cx.perfil,cx.opts); }
  async function comMarcarTodas(mountId){
    const cx=COM_CTX[mountId]; if(!cx) return; const p=cx.perfil; _bellOpen=mountId;
    const arr=await comsLeer(); const email=(p.email||"").toLowerCase(); let ch=false;
    comsParaMi(p,arr).forEach(c=>{ if(!comLeida(c,email)){ (c.leidoPor=c.leidoPor||[]).push({email,nombre:p.nombre||email,ts:new Date().toISOString()}); ch=true; } });
    if(ch) await comsGuardar(arr);
    await bellComunicaciones(mountId,p,cx.opts);
  }
  /* "Ver" del aviso WA: marca los mensajes como vistos, cierra la campana y hace scroll a la sección. */
  async function comVerWA(mountId){
    const cx=COM_CTX[mountId]; if(!cx) return; const p=cx.perfil, opts=cx.opts||{};
    const arr=await comsLeer(); const email=(p.email||"").toLowerCase();
    const nuevos=wasParaComercial(p,arr).filter(c=>!comVistoWA(c,email)).map(c=>c.id);
    await comMarcarVistoWA(p, nuevos);
    comCerrarBells();
    if(opts.waTarget && typeof document!=="undefined"){ const t=document.getElementById(opts.waTarget); if(t){ t.scrollIntoView({behavior:"smooth",block:"start"}); t.classList.add("eyg-wa-flash"); setTimeout(()=>t.classList.remove("eyg-wa-flash"),1300); } }
    await bellComunicaciones(mountId,p,opts);
  }

  return { supa, rpc, BASE, abs, money, esc, hace, argToday, argParts, argNowFrac, huella, session, perfil, login, logout, requireAuth, guard, showLogin, showChangePwd, markPwdChanged, gateMsg, topbar, DEPTS, MODULOS, puedeVer, T, sidebar, layout, homeMain, cardOfertasSemana, debounce, repintar, buscador, BUSCA_MS,
    COM_KEY, COM_DEPTS, comDeptDeRol, comsLeer, comsGuardar, comsParaMi, comLeida, comMarcarLeido,
    wasParaComercial, comVistoWA, comMarcarVistoWA, waMarker,
    bellComunicaciones, comToggleBell, comMarcarYRepintar, comMarcarTodas, comVerWA };
})();
