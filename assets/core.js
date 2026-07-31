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
    {key:"comercial", nom:"Comercial"},
    {key:"finanzas",  nom:"Finanzas"},
    {key:"inventario",nom:"Inventario"},
    {key:"datos",     nom:"Datos"},
    {key:"direccion", nom:"Dirección"},
    {key:"admin",     nom:"Sistema"},
  ];
  const MODULOS = [
    {key:"panel", dept:"comercial", cat:"Comercial", ico:"⚡",
      titulo:p=>(p.rol==="admin"||p.rol==="direccion")?"Panel comerciales":"Mi Panel",
      desc:p=>(p.rol==="admin"||p.rol==="direccion")?"El equipo: métricas resumidas de cada comercial + acceso a su panel individual y al panel del líder.":(p.rol==="lider"?"Tu panel de líder: el equipo, cumplimiento y alertas.":"Tu sesión de venta: objetivos, comisión, salud y tu cartera a mano."),
      roles:["comercial","lider"], ready:true,
      path:p=>{ if(p.rol==="admin"||p.rol==="direccion") return "comercial/comerciales.html"; if(p.rol==="lider") return "comercial/lider.html"; return `comercial/panel.html${p&&p.comercial_ref?("?c="+encodeURIComponent(p.comercial_ref)):""}`; }},
    {key:"crm",       dept:"comercial", cat:"Comercial", ico:"👥", titulo:"CRM · Clientes", desc:"Segmentá farmacias e instituciones por frecuencia y contactá por WhatsApp.", roles:["comercial","lider"], ready:false, path:()=>"comercial/crm.html"},
    {key:"precios",   dept:"comercial", cat:"Precios", ico:"🏷️", titulo:"Rentabilidad y Precios", desc:"Costo, escalera de precios por cantidad y margen por tramo, con salud por color.", roles:["comercial","lider","finanzas","inventario"], ready:true, path:()=>"comercial/precios.html"},
    {key:"config-precios", dept:"comercial", cat:"Precios", ico:"⚙️", titulo:"Configuración de precios", desc:"Reglas del sincronizador por categoría: recargo, cortes, descuentos, IVA al costo y piso de margen.", roles:["comercial","lider","finanzas"], ready:true, path:()=>"comercial/config-precios.html"},
    /* PROVISORIO: simulador de escalera de éticos A/B para revisar antes de definir. Sacar (esta línea + comercial/simulador-eticos.html) cuando se cierre. */
    {key:"sim-eticos", dept:"comercial", cat:"Precios", ico:"🧪", titulo:"Simulador Éticos (provisorio)", desc:"Prueba de la escalera A/B por laboratorio: márgenes por tramo (x1/x5/x10), filtrable por escala de margen. Módulo temporal para revisión.", roles:["direccion","lider","finanzas","inventario"], ready:true, path:()=>"comercial/simulador-eticos.html"},
    {key:"cobranzas", dept:"finanzas", cat:"Finanzas", ico:"💳", titulo:"Cobranzas", desc:"Deuda por cliente con antigüedad (+30/+60/+90/+120) para reclamar y detectar incobrables.", roles:["finanzas","lider","cobranzas"], ready:true, path:()=>"finanzas/cobranzas.html"},
    {key:"stock",     dept:"inventario", cat:"Inventario", ico:"📦", titulo:"Stock y Sobrestock", desc:"Plata inmovilizada, rotación por producto y vencimientos. Qué frenar y qué liquidar.", roles:["finanzas","inventario"], ready:true, path:()=>"inventario/stock.html"},
    {key:"nombres",   dept:"inventario", cat:"Inventario", ico:"🏷️", titulo:"Maestro de productos", desc:"Ordená el dato maestro de cada producto: nombre, unidades, embalaje y subcategoría. Detecta errores y completa lo que falta, con un clic.", roles:["inventario","maestro"], ready:true, path:()=>"inventario/nombres.html"},
    {key:"oportunidades", dept:"inventario", cat:"Inventario", ico:"💡", titulo:"Oportunidades y Ofertas", desc:"Cuando un costo baja, el sistema detecta una oportunidad de oferta. Confirmala (precio, stock, vigencia) o armá combos, y van a la tarjeta de los comerciales.", roles:["inventario"], ready:true, path:()=>"inventario/oportunidades.html"},
    {key:"contactos", dept:"datos", cat:"Datos", ico:"🗂️", titulo:"Contactos", desc:"Calidad de datos (teléfono, email, condición fiscal), duplicados y ventas por comercial.", roles:["comercial","lider","admin"], ready:false, path:()=>"datos/contactos.html"},
    /* EN PRUEBAS: oculto para todo el equipo hasta terminarlo. `pruebas` son
       huellas (SHA-256) de email — así no publicamos direcciones en el repo.
       Para liberarlo a todos: borrar la línea `pruebas` de acá y el {pruebas:…}
       del EYG.guard() de direccion/tablero.html. */
    {key:"tablero", dept:"direccion", cat:"Dirección", ico:"🗺️", titulo:"Tablero en vivo", desc:"Mapa con nuestras farmacias e instituciones, clientes activos y nuevos en tiempo real, cobertura por zona y cuánto mercado falta conquistar. Pensado para pantalla grande.", roles:["comercial","lider","finanzas","inventario"], ready:true,
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

  return { supa, rpc, BASE, abs, money, esc, hace, argToday, argParts, argNowFrac, huella, session, perfil, login, logout, requireAuth, guard, showLogin, showChangePwd, markPwdChanged, gateMsg, topbar, DEPTS, MODULOS, puedeVer, T, sidebar, layout, homeMain, cardOfertasSemana, debounce, repintar, buscador, BUSCA_MS };
})();
