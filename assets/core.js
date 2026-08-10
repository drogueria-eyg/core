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

  /* ---- Límite de concurrencia hacia Odoo --------------------------------
     Odoo Online (SaaS) tiene pocos workers: mandarle ~15 requests en paralelo
     (ráfagas de .map/Promise.all) lo satura y TODAS tardan ~20 s (medido en los
     logs de la edge function). Con ~4 en vuelo cada una vuelve en ~0.6-1 s. Este
     gate encola el resto. Lo comparten EYG.rpc y los wrappers locales de cada
     módulo (panel/precios/cobranzas/egresos) vía EYG.gate. Solo limita el fetch;
     los reintentos con backoff sueltan el turno mientras esperan. */
  const RPC_MAX = 4;
  let _rpcActive = 0; const _rpcQ = [];
  function _rpcRun(fn){
    return Promise.resolve().then(fn).finally(()=>{
      _rpcActive--;
      if(_rpcQ.length){ _rpcActive++; _rpcQ.shift()(); }
    });
  }
  function gate(fn){
    if(_rpcActive < RPC_MAX){ _rpcActive++; return _rpcRun(fn); }
    return new Promise(res=>_rpcQ.push(()=>res(_rpcRun(fn))));
  }

  /* ---- Odoo (edge function odoo-rpc) ---- */
  async function rpc(model,method,args=[],kwargs={}){
    for(let i=0;i<4;i++){ try{
      const r = await gate(()=>fetch(RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,method,args,kwargs})}));
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
    if(!p || !p.activo){ gateMsg("🔒","Sin acceso", accesoMsg(p,s), false); return; }
    const ok = esSuper(p._h) || p.rol==="admin" || p.rol==="direccion" || !roles.length || roles.includes(p.rol);
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
    if(!p || !p.activo){ gateMsg("🔒","Sin acceso", accesoMsg(p,s), false); return new Promise(()=>{}); }
    // Módulo EN PRUEBAS: sólo para las huellas de email listadas (ver puedeVer)
    const pr = opts && opts.pruebas;
    if(pr && pr.length && !pr.includes(p._h) && !esSuper(p._h)){
      gateMsg("🚧","En preparación","Este módulo todavía se está construyendo. Va a estar disponible para todo el equipo cuando esté listo.",true);
      return new Promise(()=>{});
    }
    const ok = esSuper(p._h) || p.rol==="admin" || p.rol==="direccion" || !roles.length || roles.includes(p.rol);
    if(!ok){ gateMsg("⛔","No autorizado","Este módulo no está habilitado para tu rol ("+p.rol+").",true); return new Promise(()=>{}); }
    if(p.debe_cambiar_pwd){ showChangePwd({force:true}); return new Promise(()=>{}); }
    try{ rail(p); }catch(e){}   // admin: menú lateral siempre visible (módulos de chrome propio)
    return p;
  }

  /* Mensaje del gate "Sin acceso" que dice el email exacto: si no hay perfil, es porque
     no existe una fila en core_users con ESE email; si existe pero inactivo, avisa eso.
     Sirve para diagnosticar altas (email mal tipeado / mayúsculas / dominio distinto). */
  function accesoMsg(p, s){
    const em = (s&&s.user&&s.user.email)||"";
    if(p && !p.activo) return "Tu perfil ("+em+") está desactivado (activo=false). Avisá al administrador.";
    return "No hay un perfil en el Core para "+em+". El administrador tiene que crear tu acceso con ese email exacto.";
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
    /* "Cargar venta" (comercial/vender.html) NO va como módulo suelto del menú:
       se entra desde ADENTRO del panel del comercial (botón "Cargar una venta" en panel.html). */
    {key:"crm",       dept:"comercial", cat:"Comercial", ico:"👥", titulo:"CRM · Clientes", desc:"Segmentá farmacias e instituciones por frecuencia y contactá por WhatsApp.", roles:["comercial"], ready:false, path:()=>"comercial/crm.html"},
    {key:"precios",   dept:"comercial", cat:"Precios", ico:"🏷️", titulo:"Rentabilidad y Precios", desc:"Costo, escalera de precios por cantidad y margen por tramo, con salud por color.", roles:["comercial","finanzas","inventario"], ready:true, path:()=>"comercial/precios.html"},
    {key:"config-precios", dept:"comercial", cat:"Precios", ico:"⚙️", titulo:"Motor de precios", desc:"Reglas del motor por categoría: recargo, cortes, descuentos, IVA al costo y piso de margen. Las ofertas se crean en Oportunidades y Ofertas.", roles:["comercial","finanzas"], ready:true, path:()=>"comercial/config-precios.html"},
    {key:"cobranzas", dept:"finanzas", cat:"Finanzas", ico:"💳", titulo:"Cobranzas", desc:"Deuda por cliente con antigüedad (+30/+60/+90/+120) para reclamar y detectar incobrables.", roles:["finanzas","cobranzas"], ready:true, path:()=>"finanzas/cobranzas.html"},
    /* EN PRUEBAS: consulta crediticia por CUIT (Central de Deudores del BCRA, fuente pública/gratis).
       La página le pega directo al BCRA (no usa Supabase). Gateada al super-admin hasta revisarla.
       Para liberarla: borrar la línea `pruebas` de acá y el {pruebas:…} del EYG.guard() de finanzas/situacion-crediticia.html. */
    {key:"credito", dept:"finanzas", cat:"Finanzas", ico:"🔎", titulo:"Situación crediticia", desc:"Consultá por CUIT la deuda en bancos, cheques rechazados y el historial de 2 años, directo del BCRA. Para decidir beneficios de pago sin pagar Veraz/Nosis.", roles:["finanzas","direccion","comercial","lider"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"finanzas/situacion-crediticia.html"},
    /* EN PRUEBAS: módulo de Egresos (espejo de Cobranzas). Oculto para todo el equipo
       hasta terminarlo — sólo la huella del dueño. Para liberarlo: borrar la línea
       `pruebas` de acá y el {pruebas:…} del EYG.guard() de finanzas/egresos.html. */
    {key:"egresos", dept:"finanzas", cat:"Finanzas", ico:"💸", titulo:"Egresos", desc:"Todo lo que sale: compras de mercadería, gastos operativos, financieros, impuestos y pagos a proveedores. El panorama del egreso, por naturaleza y por proveedor.", roles:["finanzas","direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"finanzas/egresos.html"},
    /* EN PRUEBAS: herramienta para cargar préstamos bancarios (comprobantes OC-X) en Odoo.
       Gateada al super-admin hasta terminarla. */
    {key:"creditos-banc", dept:"finanzas", cat:"Finanzas", ico:"🏦", titulo:"Cargar crédito bancario", desc:"Cargá los préstamos que pedís a los bancos: pegás el PDF del banco y el neto acreditado, y genera el comprobante OC-X en Odoo con capital, interés, sellados, IVA y todas las cuotas.", roles:["finanzas","direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"finanzas/creditos-bancarios.html"},
    {key:"stock",     dept:"inventario", cat:"Inventario", ico:"📦", titulo:"Stock, Compras y Reposición", desc:"Qué conviene comprar y cuándo, pedido por proveedor (borrador en Odoo), productos ganadores, sobrestock y vencimientos. Con tarjeta de salud del abastecimiento.", roles:["finanzas","inventario"], ready:true, path:()=>"inventario/stock.html"},
    {key:"nombres",   dept:"inventario", cat:"Inventario", ico:"🏷️", titulo:"Maestro de productos", desc:"Ordená el dato maestro de cada producto: nombre, unidades, embalaje y subcategoría. Detecta errores y completa lo que falta, con un clic.", roles:["inventario","maestro"], ready:true, path:()=>"inventario/nombres.html"},
    {key:"oportunidades", dept:"inventario", cat:"Inventario", ico:"💡", titulo:"Oportunidades y Ofertas", desc:"Cuando un costo baja, el sistema detecta una oportunidad de oferta. Confirmala (precio, stock, vigencia) o armá combos, y van a la tarjeta de los comerciales.", roles:["inventario"], ready:true, path:()=>"inventario/oportunidades.html"},
    /* EN PRUEBAS: CRM de contactos (existentes + por conquistar). Oculto para todo
       el equipo hasta terminarlo — sólo super-admins (Diego/German). Para liberarlo:
       borrar la línea `pruebas` de acá y el {pruebas:…} del EYG.guard() de datos/contactos.html. */
    {key:"contactos", dept:"datos", cat:"Datos", ico:"🗂️", titulo:"Contactos · CRM", desc:"Gestioná tus contactos y descubrí a quién falta conquistar: agrupá por comercial, corregí datos, reasigná comercial y cruzá con el padrón oficial de farmacias e instituciones.", roles:["comercial","lider","admin","direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"datos/contactos.html"},
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
  /* Super-admin(s): huella(email) del administrador principal (Diego Velázquez).
     SIEMPRE acceso total, incluso a módulos EN PRUEBAS. Así cualquier módulo nuevo
     que se deje con `pruebas` se le muestra automáticamente, sin sumarlo a cada lista. */
  const SUPER = [
    "a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122", // Diego Velázquez (d.velazquez@)
    "53ab45c75c97fc80109dddf425c8343ca47287b95bcad8ee868cad8fd3d171bd", // German Banquero (g.banquero@)
  ];
  const esSuper = h => !!h && SUPER.includes(h);

  function puedeVer(m, perfilORol){
    const p = (typeof perfilORol === "string") ? {rol:perfilORol} : (perfilORol||{});
    if(esSuper(p._h)) return true;   // super-admins (German y Diego) ven todo
    if(m.pruebas && m.pruebas.length && !m.pruebas.includes(p._h) && !esSuper(p._h)) return false;
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

  /* ---- Rail lateral para ADMIN en módulos de chrome propio (panel/cobranzas/precios/…) ----
     Preferencia del usuario (2026-08-09): un administrador debe ver SIEMPRE el menú lateral
     para saltar de un módulo a otro sin tener que volver al inicio. Los roles de acceso
     especial (comercial, cobranzas, finanzas, inventario, maestro) conservan la vista simple
     del módulo. Los módulos que ya dibujan su propio sidebar (EYG.layout → #eygSide) se saltean.
     No reconstruye la maqueta del módulo: mueve su contenido a una columna que flexea a la
     derecha del sidebar (se preservan nodos y listeners; getElementById sigue resolviendo). */
  function railActiveKey(){
    const path = (typeof location!=="undefined" ? location.pathname : "");
    const file = (path.split("/").pop()||"").toLowerCase();
    let key = "";
    MODULOS.forEach(m=>{ try{ const pp=String(m.path({})).split("?")[0].split("/").pop().toLowerCase(); if(pp && file===pp) key=m.key; }catch(e){} });
    return key;
  }
  function rail(perfil){
    if(typeof document==="undefined" || !perfil) return;
    const admin = esSuper(perfil._h) || perfil.rol==="admin" || perfil.rol==="direccion";
    if(!admin) return;                                 // accesos especiales: sin cambios
    if(document.getElementById("eygSide")) return;     // el módulo ya tiene menú lateral
    if(document.getElementById("eygRailApp")) return;  // idempotente
    const content = document.createElement("div");
    content.className = "eyg-railmain";
    while(document.body.firstChild){ content.appendChild(document.body.firstChild); }
    const app = document.createElement("div");
    app.className = "app"; app.id = "eygRailApp";
    app.innerHTML = sidebar(perfil, railActiveKey());
    app.appendChild(content);
    const scrim = document.createElement("div");
    scrim.className = "side-scrim";
    scrim.onclick = ()=>{ const s=document.getElementById("eygSide"); if(s) s.classList.remove("open"); };
    app.appendChild(scrim);
    document.body.appendChild(app);
    const ham = document.createElement("button");
    ham.className = "eyg-railham"; ham.type = "button"; ham.setAttribute("aria-label","Menú"); ham.textContent = "☰";
    ham.onclick = ()=>{ const s=document.getElementById("eygSide"); if(s) s.classList.toggle("open"); };
    document.body.appendChild(ham);
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

  /* Padrón del Core (para el selector de destinatarios y el denominador de lectura).
     Viene de la función SECURITY DEFINER list_core_roster: sólo responde a un usuario
     logueado y activo del Core. Se cachea. Filtra filas con email inválido. */
  let _roster=null;
  async function rosterCore(force){
    if(_roster && !force) return _roster;
    try{ const {data,error}=await supa().rpc("list_core_roster"); _roster = error?[]:(data||[]).filter(u=>u&&u.email&&u.email.includes("@")); }
    catch(e){ _roster=[]; }
    return _roster;
  }

  /* Novedades vigentes dirigidas a este perfil. admin/dirección ven todas (supervisión). */
  function comsParaMi(perfil, arr){
    const hoy = argToday(), dept = comDeptDeRol(perfil.rol), ref = perfil.comercial_ref || "", email=(perfil.email||"").toLowerCase();
    const manda = perfil.rol==="admin" || perfil.rol==="direccion";
    return (arr||[]).filter(c=>{
      if(!c || c.activo===false) return false;
      if(c.clase && c.clase!=="novedad") return false;           // sólo novedades
      if(c.desde && c.desde>hoy) return false;
      if(c.hasta && c.hasta<hoy) return false;
      if(c.alcance==="personas") return (c.personas||[]).includes(email);   // dirigida: incluso admin/dir sólo si está en la lista
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
  /* Mensajes WA que este comercial puede enviar a su cartera. Targeting por `alcance`:
     'comerciales' (todos), 'equipo' (destinatarios) o 'personas' (emails). Fallback para
     registros viejos sin alcance: gerencia→comerciales, líder→equipo. */
  function wasParaComercial(perfil, arr){
    const hoy=argToday(), ref=perfil.comercial_ref||"", email=(perfil.email||"").toLowerCase();
    return (arr||[]).filter(c=>{
      if(!(c && c.clase==="wa" && c.activo!==false && _comVig(c,hoy))) return false;
      const alc = c.alcance || (c.origen==="gerencia"?"comerciales":"equipo");
      if(alc==="comerciales") return true;
      if(alc==="equipo") return (c.destinatarios||[]).includes(ref);
      if(alc==="personas") return (c.personas||[]).includes(email);
      return false;
    }).sort((a,b)=>String(b.ts||"").localeCompare(String(a.ts||"")));
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
  const COM_CTX = {};   // mountId -> {perfil, opts, mountId, arr}
  let _bellOpen = null;
  let _lastBellMount = null;              // última campana montada (para el gestor/overlay)
  let _gs = {tab:"activas", open:new Set()};  // estado del gestor "Ver todas"
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
    .eyg-wa-flash{animation:eygWaFlash 1.2s ease-out 1;border-radius:16px}
    /* item de la campana: clickable → popup individual, cuerpo recortado a 2 líneas */
    .eyg-nov{cursor:pointer}
    .eyg-nov .bd.clip{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .eyg-nov .go2{color:#048782;font-weight:800;white-space:nowrap}
    .eyg-bell-foot{border-top:1px solid #eef1f0;margin-top:4px;padding:9px 8px 4px;text-align:center}
    .eyg-bell-foot button{background:none;border:0;color:#048782;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit}
    /* ===== Overlay gestor + popup individual ===== */
    .eyg-ov{position:fixed;inset:0;background:rgba(6,40,38,.5);z-index:10000;display:flex;justify-content:center;align-items:flex-start;padding:40px 14px;animation:eygOvIn .18s ease}
    @keyframes eygOvIn{from{opacity:0}to{opacity:1}}
    .eyg-ov .card{background:#fff;border-radius:16px;max-width:640px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden;font-family:'Archivo',system-ui,sans-serif}
    .eyg-ov .ohd{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid #eef1f0}
    .eyg-ov .ohd b{font-size:16px;color:#0E1F1D;flex:1;line-height:1.25}
    .eyg-ov .ohd .allread{background:none;border:0;color:#048782;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap}
    .eyg-ov .ox{cursor:pointer;color:#5F716E;font-size:19px;line-height:1;background:none;border:0;padding:2px 4px}
    .eyg-ov .otabs{display:flex;gap:8px;padding:12px 18px 2px}
    .eyg-ov .otab{font-size:12.5px;font-weight:700;border:1px solid #DCE8E6;background:#fff;color:#5F716E;border-radius:20px;padding:6px 13px;cursor:pointer;font-family:inherit}
    .eyg-ov .otab.on{background:#048782;border-color:#048782;color:#fff}
    .eyg-ov .obody{overflow:auto;padding:8px 12px 14px}
    .eyg-nacc{border:1px solid #e7edec;border-radius:12px;margin:8px 0;overflow:hidden;background:#fff}
    .eyg-nacc.unread{border-color:#bfe6e2;background:#f5fcfb}
    .eyg-nacc .nh{display:flex;align-items:center;gap:9px;padding:12px 14px;cursor:pointer}
    .eyg-nacc .nh .dot{width:8px;height:8px;border-radius:50%;background:#048782;flex:none}
    .eyg-nacc .nh .tt{flex:1;font-weight:800;font-size:13.5px;color:#0E1F1D;line-height:1.3}
    .eyg-nacc .nh .dd{font-size:11px;color:#8A9A97;white-space:nowrap}
    .eyg-nacc .nh .cv{color:#8A9A97;transition:transform .2s;font-size:12px}
    .eyg-nacc.open .nh .cv{transform:rotate(180deg)}
    .eyg-nacc .nb{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s ease}
    .eyg-nacc.open .nb{grid-template-rows:1fr}
    .eyg-nacc .nbw{overflow:hidden}
    .eyg-nacc .nbin{padding:0 14px 12px}
    .eyg-nacc .nbin .bd{font-size:13px;color:#3a4a47;white-space:pre-wrap;line-height:1.5}
    .eyg-nacc .nact{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}
    .eyg-nacc .nact button{font-family:inherit;font-size:12px;font-weight:700;border-radius:8px;padding:6px 12px;cursor:pointer;border:1px solid #DCE8E6;background:#fff;color:#3a4a47}
    .eyg-nacc .nact button.pri{background:#04635F;color:#fff;border-color:#04635F}
    .eyg-nmodal .card{max-width:520px}
    .eyg-nmodal .nmbody{padding:16px 20px;overflow:auto}
    .eyg-nmodal .nmbody .meta{font-size:11.5px;color:#8A9A97}
    .eyg-nmodal .nmbody .bd{font-size:14px;color:#2a3a37;white-space:pre-wrap;line-height:1.55;margin-top:9px}
    .eyg-nmodal .nmfoot{display:flex;gap:10px;padding:12px 18px;border-top:1px solid #eef1f0}
    .eyg-nmodal .nmfoot button{flex:1;font-family:inherit;font-size:13.5px;font-weight:700;border-radius:10px;padding:11px;cursor:pointer;border:1px solid #DCE8E6;background:#fff;color:#3a4a47}
    .eyg-nmodal .nmfoot button.pri{background:#048782;color:#fff;border-color:#048782}
    .eyg-nmodal .nmfoot button:disabled{opacity:.5;cursor:default}`;
    document.head.appendChild(s);
  }
  function comCerrarBells(){ if(typeof document==="undefined") return; document.querySelectorAll(".eyg-bell-dd").forEach(d=>d.style.display="none"); _bellOpen=null; }
  if(typeof document!=="undefined"){ document.addEventListener("click",e=>{ if(!(e.target.closest && e.target.closest(".eyg-bell-wrap"))) comCerrarBells(); }); }

  /* Monta/re-pinta la campana en el elemento `mountId`. Idempotente: llamala cada vez.
     opts.wa=true agrega el aviso de mensajes de WhatsApp para enviar; opts.waTarget = id del
     bloque de la sección WhatsApp al que hace scroll el botón "Ver". */
  async function bellComunicaciones(mountId, perfil, opts){
    const mount=document.getElementById(mountId); if(!mount||!perfil) return;
    opts=opts||{}; comBellStyles(); COM_CTX[mountId]={perfil, opts, mountId}; _lastBellMount=mountId;
    let arr; try{ arr=await comsLeer(); }catch(e){ arr=[]; }
    COM_CTX[mountId].arr=arr;
    const email=(perfil.email||"").toLowerCase();
    // La campana muestra las ACTIVAS (no archivadas). Las archivadas viven en el gestor "Ver todas".
    const mineAll=comsParaMi(perfil,arr);
    const mine=mineAll.filter(c=>!comArchivada(c,email)).sort((a,b)=>{ const la=comLeida(a,email),lb=comLeida(b,email); if(la!==lb) return la?1:-1; return ((b.prioridad==="alta")-(a.prioridad==="alta"))||String(b.ts||"").localeCompare(String(a.ts||"")); });
    const nUnread=mine.filter(c=>!comLeida(c,email)).length;
    const waNuevos = opts.wa ? wasParaComercial(perfil,arr).filter(c=>!comVistoWA(c,email)) : [];
    const nBadge = nUnread + waNuevos.length;
    const fD=s=>s?(String(s).slice(8,10)+"/"+String(s).slice(5,7)):"";
    const abierto=_bellOpen===mountId;
    // Item compacto: tocarlo abre el popup individual (ventana emergente) para leerlo completo.
    const item=c=>{ const leida=comLeida(c,email);
      return `<div class="eyg-nov ${leida?'':'unread'}" onclick="EYG.comAbrirNota('${mountId}','${c.id}')">
        <div class="t">${!leida?'<span class="dot"></span>':''}${c.prioridad==="alta"?'<span class="eyg-bell-alta">Importante</span>':''}${esc(c.titulo||"")}</div>
        <div class="bd clip">${esc(c.cuerpo||"")}</div>
        <div class="mt"><span>${esc(c.autor||"")}${c.ts?" · "+fD(c.ts.slice(0,10)):""}</span><span class="go2">Abrir →</span></div>
      </div>`;
    };
    const waBanner = waNuevos.length ? `<div class="eyg-wa-banner" onclick="EYG.comVerWA('${mountId}')">📱 <span><b>${waNuevos.length}</b> mensaje${waNuevos.length>1?'s':''} de WhatsApp para enviar a tus clientes</span><span class="go">Ver ↓</span></div>` : '';
    mount.innerHTML=`<div class="eyg-bell-wrap">
      <button class="eyg-bell-btn" title="Notificaciones" onclick="EYG.comToggleBell(event,'${mountId}')">🔔${nBadge?`<span class="eyg-bell-badge">${nBadge>9?'9+':nBadge}</span>`:''}</button>
      <div class="eyg-bell-dd" style="display:${abierto?'block':'none'}">
        ${waBanner}
        <div class="hd"><b>🔔 Notificaciones</b>${nUnread?`<button class="allread" onclick="EYG.comMarcarTodas('${mountId}')">Marcar todas leídas</button>`:''}</div>
        ${mine.length?mine.map(item).join(""):'<div class="eyg-bell-empty">No tenés notificaciones nuevas.</div>'}
        <div class="eyg-bell-foot"><button onclick="EYG.comAbrirGestor('${mountId}')">🗂️ Ver todas${mineAll.length?` (${mineAll.length})`:''} →</button></div>
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

  /* ===== GESTOR DE NOTIFICACIONES =====
     Archivado por-usuario (archivadoPor, igual molde que leidoPor: RMW del array compartido, no
     borra la novedad para los demás). Popup individual (leer completo) + overlay "Ver todas" con
     acordeón, pestañas Activas/Archivadas y acciones (leído/archivar/restaurar). */
  function comArchivada(c, email){ return (c.archivadoPor||[]).includes((email||"").toLowerCase()); }
  async function comSetArchivo(perfil, id, arch){
    const email=(perfil.email||"").toLowerCase();
    const arr=await comsLeer(); const c=arr.find(x=>x.id===id); if(!c) return;
    c.archivadoPor=c.archivadoPor||[]; const has=c.archivadoPor.includes(email);
    if(arch && !has) c.archivadoPor.push(email);
    else if(!arch && has) c.archivadoPor=c.archivadoPor.filter(e=>e!==email);
    await comsGuardar(arr);
  }
  const _fFecha=s=>s?(String(s).slice(8,10)+"/"+String(s).slice(5,7)+"/"+String(s).slice(0,4)):"";
  function _ovHost(){ let h=document.getElementById("eyg-ov-host"); if(!h){ h=document.createElement("div"); h.id="eyg-ov-host"; document.body.appendChild(h); } return h; }
  function comCerrarOverlay(){ const h=document.getElementById("eyg-ov-host"); if(h) h.innerHTML=""; }
  function _ovBg(ev){ if(ev.target.classList && ev.target.classList.contains("eyg-ov")) comCerrarOverlay(); }
  async function _refrescar(cx){
    if(cx && cx.mountId) await bellComunicaciones(cx.mountId, cx.perfil, cx.opts);
    const host=document.getElementById("eyg-ov-host");
    if(host && host.querySelector(".eyg-ov") && !host.querySelector(".eyg-nmodal")) await _pintarGestor(cx);
  }
  /* Popup individual: abre para leer completo y marca leído (leer = leído). */
  async function comAbrirNota(mountId, id){
    const cx=COM_CTX[mountId]||COM_CTX[_lastBellMount]; if(!cx) return; _lastBellMount=cx.mountId;
    comCerrarBells();
    await comMarcarLeido(cx.perfil, id);
    const arr=await comsLeer(); cx.arr=arr;
    const email=(cx.perfil.email||"").toLowerCase();
    const c=arr.find(x=>x.id===id);
    await bellComunicaciones(cx.mountId, cx.perfil, cx.opts);
    if(!c){ return; }
    const arch=comArchivada(c,email);
    _ovHost().innerHTML=`<div class="eyg-ov eyg-nmodal" onclick="EYG._ovBg(event)"><div class="card">
      <div class="ohd">${c.prioridad==="alta"?'<span class="eyg-bell-alta">Importante</span>':''}<b>${esc(c.titulo||"")}</b><button class="ox" title="Cerrar" onclick="EYG.comCerrarOverlay()">✕</button></div>
      <div class="nmbody"><div class="meta">${esc(c.autor||"")}${c.ts?" · "+_fFecha(c.ts.slice(0,10)):""}</div><div class="bd">${esc(c.cuerpo||"")||"(sin texto)"}</div></div>
      <div class="nmfoot">
        <button onclick="EYG.comArchivarDesde('${c.id}',${arch?'false':'true'})">${arch?'♻️ Restaurar':'🗂️ Archivar'}</button>
        <button class="pri" onclick="EYG.comCerrarOverlay()">Cerrar</button>
      </div>
    </div></div>`;
  }
  /* Overlay "Ver todas": acordeón con pestañas Activas / Archivadas. */
  async function comAbrirGestor(mountId){
    const cx=COM_CTX[mountId]||COM_CTX[_lastBellMount]; if(!cx) return; _lastBellMount=cx.mountId;
    comCerrarBells(); _gs.tab="activas"; _gs.open=new Set();
    await _pintarGestor(cx);
  }
  async function _pintarGestor(cx){
    if(!cx) return; const p=cx.perfil, email=(p.email||"").toLowerCase();
    const arr=await comsLeer(); cx.arr=arr;
    const mine=comsParaMi(p,arr);
    const activas=mine.filter(c=>!comArchivada(c,email));
    const archivadas=mine.filter(c=>comArchivada(c,email));
    const lista=(_gs.tab==="activas"?activas:archivadas).slice().sort((a,b)=>{
      const la=comLeida(a,email),lb=comLeida(b,email); if(_gs.tab==="activas" && la!==lb) return la?1:-1;
      return ((b.prioridad==="alta")-(a.prioridad==="alta"))||String(b.ts||"").localeCompare(String(a.ts||""));
    });
    const nUnread=activas.filter(c=>!comLeida(c,email)).length;
    const item=c=>{ const leida=comLeida(c,email), open=_gs.open.has(c.id), a=comArchivada(c,email);
      return `<div class="eyg-nacc ${leida?'':'unread'} ${open?'open':''}" data-id="${c.id}">
        <div class="nh" onclick="EYG._gsToggle(event,'${c.id}')">${!leida?'<span class="dot"></span>':''}<span class="tt">${c.prioridad==="alta"?'⚠️ ':''}${esc(c.titulo||"")}</span><span class="dd">${c.ts?_fFecha(c.ts.slice(0,10)):""}</span><span class="cv">▾</span></div>
        <div class="nb"><div class="nbw"><div class="nbin">
          <div style="font-size:11px;color:#8A9A97;margin-bottom:6px">${esc(c.autor||"")}</div>
          <div class="bd">${esc(c.cuerpo||"")||"(sin texto)"}</div>
          <div class="nact">
            ${leida?'':`<button class="pri" onclick="EYG.comLeidoDesde('${c.id}')">✓ Marcar leído</button>`}
            <button onclick="EYG.comArchivarDesde('${c.id}',${a?'false':'true'})">${a?'♻️ Restaurar':'🗂️ Archivar'}</button>
          </div>
        </div></div></div>
      </div>`;
    };
    const vacio=_gs.tab==="activas"?"No tenés notificaciones activas.":"No hay notificaciones archivadas.";
    _ovHost().innerHTML=`<div class="eyg-ov" onclick="EYG._ovBg(event)"><div class="card">
      <div class="ohd"><b>🔔 Notificaciones</b>${nUnread?`<button class="allread" onclick="EYG.comMarcarTodasGestor()">Marcar todas leídas</button>`:''}<button class="ox" title="Cerrar" onclick="EYG.comCerrarOverlay()">✕</button></div>
      <div class="otabs">
        <button class="otab ${_gs.tab==="activas"?"on":""}" onclick="EYG._gsTab('activas')">Activas (${activas.length})</button>
        <button class="otab ${_gs.tab==="archivadas"?"on":""}" onclick="EYG._gsTab('archivadas')">Archivadas (${archivadas.length})</button>
      </div>
      <div class="obody">${lista.length?lista.map(item).join(""):'<div class="eyg-bell-empty">'+vacio+'</div>'}</div>
    </div></div>`;
  }
  function _gsTab(t){ _gs.tab=t; _gs.open=new Set(); _pintarGestor(COM_CTX[_lastBellMount]); }
  /* Abrir/cerrar acordeón sin re-render (preserva scroll). */
  function _gsToggle(ev, id){ if(ev) ev.stopPropagation(); const card=ev.target.closest(".eyg-nacc"); if(!card) return; const open=card.classList.toggle("open"); if(open) _gs.open.add(id); else _gs.open.delete(id); }
  async function comLeidoDesde(id){ const cx=COM_CTX[_lastBellMount]; if(!cx) return; await comMarcarLeido(cx.perfil,id); await _refrescar(cx); }
  async function comArchivarDesde(id, arch){ const cx=COM_CTX[_lastBellMount]; if(!cx) return; await comSetArchivo(cx.perfil,id, arch!==false && arch!=="false"); if(document.getElementById("eyg-ov-host")&&document.querySelector(".eyg-nmodal")) comCerrarOverlay(); await _refrescar(cx); }
  async function comMarcarTodasGestor(){
    const cx=COM_CTX[_lastBellMount]; if(!cx) return; const p=cx.perfil, email=(p.email||"").toLowerCase();
    const arr=await comsLeer(); let ch=false;
    comsParaMi(p,arr).filter(c=>!comArchivada(c,email)).forEach(c=>{ if(!comLeida(c,email)){ (c.leidoPor=c.leidoPor||[]).push({email,nombre:p.nombre||email,ts:new Date().toISOString()}); ch=true; } });
    if(ch) await comsGuardar(arr);
    await _refrescar(cx);
  }

  /* ---- Presencia (heartbeat en el Core) ----
     Cada comercial registra SU PROPIA franja de conexión del día en el parámetro
     ir.config_parameter `eyg.presencia.<uid>` (solo él escribe su clave → sin carreras).
     El panel del líder lo lee para ver quién está en línea y cuánto se conecta.
     bandas = [[inicioISO, finISO], ...] del día; un hueco > 5 min abre una banda nueva. */
  let _presTimer=null, _lastPing=0, _lastAct=Date.now();
  // Se considera "activo" si la pestaña está en primer plano O si hubo interacción real
  // (mouse/clic/teclado/scroll) en los últimos 5 min. Un fondo quieto NO cuenta.
  function _presActivo(){
    if(typeof document==="undefined") return true;
    return document.visibilityState==="visible" || (Date.now()-_lastAct < 5*60000);
  }
  async function presenciaPing(uid, force){
    if(!uid) return;
    if(!force && !_presActivo()) return;   // fondo quieto: no cuenta ni escribe (menos carga)
    try{
      const key="eyg.presencia."+uid;
      const raw=await rpc("ir.config_parameter","get_param",[key]).catch(()=>null);
      let st={}; try{ st=JSON.parse(raw||"{}")||{}; }catch(e){ st={}; }
      const now=new Date(), nowISO=now.toISOString(), hoy=argToday();
      if(st.dia!==hoy){ st.dia=hoy; st.bandas=[]; }
      const b=Array.isArray(st.bandas)?st.bandas:[]; const last=b[b.length-1];
      // hueco < 6 min → sigue la misma banda; si no, abre una nueva (marca un corte real).
      if(last && (now-new Date(last[1]))<6*60000){ last[1]=nowISO; } else { b.push([nowISO,nowISO]); }
      st.bandas=b; st.online=nowISO;
      if(Date.now()-_lastAct < 90000) st.lastAct=nowISO;   // última interacción (mouse/clic/teclado)
      await rpc("ir.config_parameter","set_param",[key, JSON.stringify(st)]);
    }catch(e){}
  }
  function startPresencia(uid){
    if(!uid || _presTimer) return;
    const ping=(force)=>{ _lastPing=Date.now(); presenciaPing(uid, force); };
    ping(true);
    _presTimer=setInterval(()=>ping(false), 60000);   // cada 1 min (más fino que antes)
    if(typeof document==="undefined") return;
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") ping(true); });
    // Interacción real → marca actividad y, si pasó >25s del último ping, refresca ya.
    const onAct=()=>{ _lastAct=Date.now(); if(Date.now()-_lastPing>25000) ping(true); };
    ["mousemove","mousedown","keydown","scroll","touchstart","wheel"].forEach(ev=>document.addEventListener(ev,onAct,{passive:true}));
    // Al cerrar/ocultar la ventana → cierra la banda en el horario EXACTO del cierre.
    window.addEventListener("pagehide",()=>{ try{ ping(true); }catch(e){} });
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") ping(true); });
  }

  /* ===== Riesgo de pago del contacto (COMPARTIDO en todo el Core) =====
     Un solo vistazo del riesgo, encadenando datos VIVOS: la cuenta corriente real
     (misma base que Cobranzas) + marcadores (bóveda "incobrable" de Cobranzas y una
     marca manual de "problemas de pago"). Como se deriva del dato vivo, si el cliente
     regulariza (paga lo vencido / sale de bóveda) la alerta se apaga SOLA. El BCRA
     (situación crediticia) es una consulta aparte por CUIT: riesgoBCRA(cuit).
     Uso en cualquier módulo:
       const R = await EYG.riesgoCartera();        // {partnerId: {nivel, vencido, mora, ...}}
       elem.innerHTML = EYG.badgeRiesgo(R[id]?.nivel);   // ⚠ badge (o "")
     Niveles: 'alto' (⚠ no ofrecer plazos) · 'atencion' (deuda vencida) · 'ok'. */
  const RIESGO_TAG="[RIESGO-PAGO]";
  async function riesgoCartera(){
    const hoy=argToday();
    const dom=[["account_id.account_type","=","asset_receivable"],["parent_state","=","posted"],["full_reconcile_id","=",false],["amount_residual","!=",0]];
    const [lines,msgs]=await Promise.all([
      rpc("account.move.line","search_read",[dom,["partner_id","amount_residual","date_maturity","move_type"]],{limit:0}),
      rpc("mail.message","search_read",[[["model","=","res.partner"],"|",["body","like","[BOVEDA]"],["body","like",RIESGO_TAG]]],{fields:["res_id","body","date"],limit:0})
    ]);
    const M={}; const g=id=>M[id]||(M[id]={deuda:0,vgross:0,gris:0,venc:null});
    for(const l of lines){ if(!l.partner_id) continue; const o=g(l.partner_id[0]); const r=l.amount_residual||0; o.deuda+=r;
      if(l.move_type==="entry" && r<0) o.gris+=-r;                                   // cobrado sin imputar (retenciones/gris)
      else if(r>0 && l.date_maturity && l.date_maturity<hoy){ o.vgross+=r; if(!o.venc||l.date_maturity<o.venc) o.venc=l.date_maturity; } }
    msgs.sort((a,b)=>(b.date||"").localeCompare(a.date||"")); const vb=new Set(),vr=new Set();
    for(const m of msgs){ const b=(m.body||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ");
      if(b.includes("[BOVEDA]") && !b.includes("[BOVEDA-CONTACTO]")){ if(!vb.has(m.res_id)){ vb.add(m.res_id); if(!/salir/i.test(b) && /incobrable/i.test(b)) g(m.res_id).bovIncobrable=true; } }
      else if(b.includes(RIESGO_TAG)){ if(!vr.has(m.res_id)){ vr.add(m.res_id); const o=g(m.res_id); if(/salir/i.test(b)) o.manual=false; else { o.manual=true; o.manualNota=(b.split("]").slice(1).join("]")||"").trim(); } } } }
    for(const id in M){ const o=M[id]; o.vencido=Math.max(0,(o.vgross||0)-(o.gris||0)); o.mora=o.venc?Math.max(0,Math.floor((new Date(hoy+"T00:00:00")-new Date(String(o.venc).slice(0,10)+"T00:00:00"))/864e5)):0; o.nivel=riesgoNivel(o); o.motivo=riesgoMotivo(o); }
    return M;
  }
  function riesgoNivel(o){ const V=o.vencido||0, mora=o.mora||0;
    // exige deuda vencida REAL (si el gris/retenciones cubrió lo vencido, no alerta)
    if(o.manual || o.bovIncobrable || (V>1000&&mora>=90)) return "alto";
    if(V>1000 && mora>=30) return "atencion";
    return "ok"; }
  function riesgoMotivo(o){ const mot=[]; const V=o.vencido||0, mora=o.mora||0;
    if(o.manual) mot.push(o.manualNota?("⚑ "+o.manualNota):"marcado con problemas de pago");
    if(o.bovIncobrable) mot.push("marcado incobrable en Cobranzas");
    if(V>1000 && mora>=121) mot.push("deuda vencida +120 días ("+money(V)+")");
    else if(V>1000 && mora>=30) mot.push("deuda vencida hace "+mora+" días ("+money(V)+")");
    return mot.join(" · "); }
  function riesgoStyles(){ if(typeof document==="undefined"||document.getElementById("eyg-riesgo-css")) return; const s=document.createElement("style"); s.id="eyg-riesgo-css"; s.textContent=".eyg-riesgo{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:20px;white-space:nowrap}.eyg-riesgo.alto{background:#FBE4E3;color:#B0322F}.eyg-riesgo.aten{background:#FBF0DA;color:#9A6B12}"; document.head.appendChild(s); }
  function badgeRiesgo(nivel){ if(!nivel||nivel==="ok") return ""; riesgoStyles(); return nivel==="alto"?'<span class="eyg-riesgo alto" title="No ofrecer plazos de pago">⚠ Riesgo de pago</span>':'<span class="eyg-riesgo aten" title="Tiene deuda vencida">⚠ Atención</span>'; }
  async function marcarRiesgo(id,nota){ return rpc("res.partner","message_post",[[id]],{body:"⚑ "+RIESGO_TAG+" "+(nota||""),message_type:"comment"}); }
  async function sacarRiesgo(id){ return rpc("res.partner","message_post",[[id]],{body:"✅ "+RIESGO_TAG+" salir",message_type:"comment"}); }
  /* BCRA (Central de Deudores) por CUIT → resumen + nivel ponderado por monto. */
  async function riesgoBCRA(cuit){
    const c=(cuit||"").replace(/\D/g,""); if(c.length!==11) return null;
    try{
      const r=await fetch("https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/"+c,{headers:{Accept:"application/json"}});
      if(r.status===404) return {sinRegistros:true};
      if(!r.ok) throw new Error("BCRA "+r.status);
      const res=(await r.json()).results||{}; const per=(res.periodos&&res.periodos[0])||null;
      const ents=((per&&per.entidades)||[]).filter(e=>e.situacion>0||e.monto>0);
      let total=0,irreg=0,sitMax=0,jud=false;
      ents.forEach(e=>{ const m=(e.monto||0)*1000; total+=m; const s=e.situacion||0; if(s>sitMax)sitMax=s; if(s>=3)irreg+=m; if(e.procesoJud||e.situacionJuridica)jud=true; });
      // semáforo PONDERADO por monto (no por la peor situación puntual): rojo solo si lo
      // irregular pesa ≥10% del total o hay proceso judicial. Un gran deudor sano con una
      // deuda chica en sit.5 queda amarillo, no rojo (ver [[eyg-core-situacion-crediticia]]).
      const pct=total?irreg/total:0;
      const nivel=(jud||pct>=0.10)?"alto":(irreg>0)?"atencion":"ok";
      return {periodo:per&&per.periodo, total, irreg, sitMax, pct, jud, nivel, n:ents.length};
    }catch(e){ return {error:e.message}; }
  }

  return { supa, rpc, gate, BASE, abs, money, esc, hace, argToday, argParts, argNowFrac, huella, session, perfil, login, logout, requireAuth, guard, showLogin, showChangePwd, markPwdChanged, gateMsg, topbar, DEPTS, MODULOS, puedeVer, T, sidebar, layout, homeMain, rail, railActiveKey, cardOfertasSemana, debounce, repintar, buscador, BUSCA_MS, presenciaPing, startPresencia,
    riesgoCartera, riesgoNivel, riesgoMotivo, badgeRiesgo, marcarRiesgo, sacarRiesgo, riesgoBCRA, RIESGO_TAG,
    COM_KEY, COM_DEPTS, comDeptDeRol, comsLeer, comsGuardar, rosterCore, comsParaMi, comLeida, comMarcarLeido,
    wasParaComercial, comVistoWA, comMarcarVistoWA, waMarker,
    bellComunicaciones, comToggleBell, comMarcarYRepintar, comMarcarTodas, comVerWA,
    comArchivada, comSetArchivo, comAbrirNota, comAbrirGestor, comCerrarOverlay,
    comLeidoDesde, comArchivarDesde, comMarcarTodasGestor, _ovBg, _gsTab, _gsToggle };
})();
