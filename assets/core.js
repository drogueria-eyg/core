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
    const {data} = await supa().from("core_users").select("email,nombre,rol,comercial_ref,activo,debe_cambiar_pwd,modulos_extra,modulos_quita").eq("email",email).maybeSingle();
    if(data) data._h = await huella(data.email || email);
    /* Interruptores del Core (core_config). Se leen acá, una vez, para que el
       encierro del comercial —que es sincrónico— pueda consultarlos. Encender
       algo es cambiar una fila en la base: no hay que tocar código ni publicar. */
    if(data){
      data._cfg = {};
      try{
        const {data:cfg} = await supa().from("core_config").select("clave,valor");
        for(const c of cfg||[]) data._cfg[c.clave]=c.valor;
      }catch(e){ /* sin config, todo queda apagado, que es lo seguro */ }
    }
    return data;
  }
  async function login(email,pwd){ return await supa().auth.signInWithPassword({email:(email||"").trim().toLowerCase(),password:pwd}); }
  async function logout(){ try{ await supa().auth.signOut(); }catch(e){} location.href=BASE; }

  /* ---- Encierro del rol "comercial" ------------------------------------
     Un comercial vive dentro de su sesión de venta y nada más: puede estar en
     su panel y en "Cargar venta" (que se abre desde adentro del panel). Cualquier
     otra página del Core (inicio, precios, comunicaciones, etc.) lo devuelve a su
     panel. Su menú/tarjetas quedan sólo con "Mi Panel" (ver puedeVer). Convive con
     los permisos por persona: si a un comercial se le concede un módulo suelto
     (modulos_extra), esa página SÍ lo deja entrar. Se aplica en requireAuth y en
     guard, apenas se confirma el perfil. Reversible: borrar este bloque y sus dos
     llamadas + la línea de puedeVer. */
  const COMERCIAL_OK = ["panel.html","vender.html","pendientes.html"];
  function comercialLock(p){
    if(!p || p.rol!=="comercial") return false;
    if(typeof location==="undefined") return false;
    const file = (location.pathname.split("/").pop()||"").toLowerCase();
    if(COMERCIAL_OK.includes(file)) return false;   // ya está donde puede estar
    /* WhatsApp: se abre para comerciales solo si el interruptor está encendido.
       Adentro es de solo lectura y recortado a sus clientes por el servidor
       (wsp-visibles), no por esta página. */
    if(file==="whatsapp.html" && p._cfg && p._cfg.wsp_comerciales===true) return false;
    const mk = railActiveKey();                     // ¿esta página es un módulo concedido?
    if(mk && (p.modulos_extra||[]).includes(mk)) return false;
    location.replace(abs("comercial/panel.html"));  // el resto → a su panel
    return true;
  }

  /* Portón: requireAuth(rolesPermitidos, cb). [] = cualquier logueado. admin/direccion pueden todo. */
  async function requireAuth(roles, cb){
    document.body.innerHTML = '<div class="gate"><div class="spinner"></div><div>Verificando acceso…</div></div>';
    let s; try{ s = await session(); }catch(e){ showLogin(); return; }
    if(!s){ showLogin(); return; }
    const p = await perfil();
    if(!p || !p.activo){ gateMsg("🔒","Sin acceso", accesoMsg(p,s), false); return; }
    if(comercialLock(p)) return;   // comercial fuera de su panel → a su panel
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
    if(comercialLock(p)) return new Promise(()=>{});   // comercial fuera de su panel → a su panel
    /* Permisos por persona: resolvemos el módulo actual por el archivo (mismo
       criterio que el menú). Una concesión (extra) habilita incluso un módulo
       EN PRUEBAS; una quita lo bloquea. Los supers no se ven afectados. */
    const mk = railActiveKey();
    const extra = !esSuper(p._h) && !!mk && (p.modulos_extra||[]).includes(mk);
    const quita = !esSuper(p._h) && !!mk && (p.modulos_quita||[]).includes(mk);
    // Módulo EN PRUEBAS: sólo huellas listadas, super, o concesión explícita
    const pr = opts && opts.pruebas;
    /* Un interruptor de core_config puede liberar un módulo en pruebas para
       ciertos roles (opts.abre = {clave, roles}). Se usa en WhatsApp: sin él,
       el candado de pruebas frenaría a las comerciales aunque el interruptor
       esté encendido. */
    const abre = opts && opts.abre;
    const liberado = !!(abre && p._cfg && p._cfg[abre.clave]===true && (abre.roles||[]).includes(p.rol));
    if(pr && pr.length && !pr.includes(p._h) && !esSuper(p._h) && !extra && !liberado){
      gateMsg("🚧","En preparación","Este módulo todavía se está construyendo. Va a estar disponible para todo el equipo cuando esté listo.",true);
      return new Promise(()=>{});
    }
    let ok = esSuper(p._h) || p.rol==="admin" || p.rol==="direccion" || !roles.length || roles.includes(p.rol);
    if(quita) ok=false; else if(!ok && extra) ok=true;
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
      <div style="text-align:center;margin-top:12px"><a href="#" id="lg-forgot" style="font-size:13px;color:var(--gris);text-decoration:none">¿Olvidaste tu contraseña?</a></div>
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
    /* Olvidé mi contraseña: manda el mail de restablecimiento (SMTP de Supabase)
       que aterriza en recuperar.html con una sesión de recuperación. */
    const fg=document.getElementById("lg-forgot");
    if(fg) fg.onclick=async e=>{
      e.preventDefault();
      const email=(em.value||"").trim().toLowerCase();
      ms.className="msg";
      if(!email){ ms.className="msg err"; ms.textContent="Escribí tu email arriba y volvé a tocar el enlace."; em.focus(); return; }
      const t0=fg.textContent; fg.textContent="Enviando…";
      const {error}=await supa().auth.resetPasswordForEmail(email,{redirectTo:BASE+"recuperar.html"});
      fg.textContent=t0;
      if(error){ ms.className="msg err"; ms.textContent="No pude enviar el mail: "+error.message; return; }
      ms.className="msg ok"; ms.textContent="Te enviamos un mail para restablecer la contraseña. Revisá tu casilla (y el spam).";
    };
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
  /* Áreas del Core, en el orden en que se recorren (menú lateral + inicio).
     Un depto sin módulos habilitados NO se dibuja (ver el .filter de sidebar/home):
     "Depósito y Logística" y "Calidad" quedan creados y listos para llenar. */
  const DEPTS = [
    {key:"comercial", nom:"Comercial"},
    {key:"compras",   nom:"Compras y Abastecimiento"},
    {key:"deposito",  nom:"Depósito y Logística"},
    {key:"calidad",   nom:"Calidad"},
    {key:"finanzas",  nom:"Administración y Finanzas"},
    {key:"precios",   nom:"Precios y Rentabilidad"},
    {key:"portal",    nom:"Portal web"},
    {key:"manuales",  nom:"Manuales y Capacitación"},
    {key:"direccion", nom:"Dirección"},
    {key:"admin",     nom:"Sistema"},
  ];
  const MODULOS = [
    /* Portal web = TODO lo del portal de clientes (drogueriaeyg.odoo.com) junto:
       cómo viene el portal, la cinta de avisos que ven los clientes y las noticias.
       Acá se irán sumando notificaciones, campañas y demás cosas de la web. */
    {key:"portal", dept:"portal", cat:"Portal web", ico:"🌐", titulo:"Portal web",
      desc:"Cómo viene el portal de clientes: visitas, pedidos online y clientes que entran. Además, la cinta de avisos que ven en el portal y las noticias que se publican.",
      roles:["lider"], ready:true, path:()=>"portal/portal.html"},
    /* EN PRUEBAS: WhatsApp de EyG. Bandeja propia en Core (los mensajes viven en
       Odoo, que es quien habla con Meta) + interruptor del asistente wsp-agente.
       La config del bot es el parámetro eyg.wsp_bot (activo / números de prueba /
       conversaciones tomadas por el equipo). Para liberarlo: borrar la línea
       `pruebas` de acá y el {pruebas:…} del EYG.guard() de comunicaciones/whatsapp.html. */
    {key:"whatsapp", dept:"comercial", cat:"Comercial", ico:"💬", titulo:"WhatsApp",
      desc:"Los mensajes de los clientes: leelos y respondelos desde acá. Con el asistente que atiende consultas simples y te deriva lo importante — lo encendés y apagás vos.",
      roles:["comercial","lider"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"comunicaciones/whatsapp.html"},
    {key:"comunicaciones", dept:"direccion", cat:"Dirección", ico:"📣",
      titulo:p=>(p.rol==="admin"||p.rol==="direccion"||p.rol==="lider")?"Comunicaciones":"Novedades",
      desc:p=>(p.rol==="admin"||p.rol==="direccion")?"Bajá novedades a toda la empresa o a un área y seguí quién las leyó."
             :(p.rol==="lider"?"Novedades para tu equipo y las bajadas de Gerencia, con acuse de lectura.":"Las novedades y bajadas que te llegan de Gerencia y de tu líder."),
      roles:["comercial","lider","finanzas","inventario","cobranzas","maestro"], ready:true,
      path:()=>"comunicaciones/comunicaciones.html"},
    /* Manuales y Capacitación: biblioteca de guías e instructivos por área (inducción,
       procedimientos, etc.). El primer manual es el Guion Comercial. La ven líderes y
       gerencia; los comerciales llegan al Guion por un atajo dentro de su panel (están
       "encerrados" en su sesión). A medida que sumen manuales de Depósito/Calidad/etc.,
       se agregan en manuales/index.html y, si hace falta, se amplían los roles de acá. */
    {key:"manuales", dept:"manuales", cat:"Manuales y Capacitación", ico:"📚", titulo:"Manuales",
      desc:"Guías, instructivos e inducción del equipo, ordenados por área. Empezá por el Guion Comercial de ventas.",
      roles:["lider"], ready:true,
      path:()=>"manuales/index.html"},
    {key:"panel", dept:"comercial", cat:"Comercial", ico:"⚡",
      titulo:p=>(p.rol==="admin"||p.rol==="direccion")?"Panel comerciales":"Mi Panel",
      desc:p=>(p.rol==="admin"||p.rol==="direccion")?"El equipo: métricas resumidas de cada comercial + acceso a su panel individual y al panel del líder.":(p.rol==="lider"?"Tu panel de líder: el equipo, cumplimiento y alertas.":"Tu sesión de venta: objetivos, comisión, salud y tu cartera a mano."),
      roles:["comercial","lider"], ready:true,
      path:p=>{ if(p.rol==="admin"||p.rol==="direccion") return "comercial/comerciales.html"; if(p.rol==="lider") return "comercial/lider.html"; return `comercial/panel.html${p&&p.comercial_ref?("?c="+encodeURIComponent(p.comercial_ref)):""}`; }},
    /* "Cargar venta" (comercial/vender.html) NO va como módulo suelto del menú:
       se entra desde ADENTRO del panel del comercial (botón "Cargar una venta" en panel.html). */
    /* "CRM · Clientes" (comercial/crm.html) se unificó en "Clientes (CRM)" — el módulo real
       es datos/contactos.html (abajo, en Comercial). Se sacó la tarjeta placeholder duplicada. */
    /* Precios y Rentabilidad: función de ADMINISTRACIÓN (define/analiza precios, escalas y
       costos). NO la ve el comercial: cuando carga una venta, Odoo ya calcula el precio. */
    {key:"precios",   dept:"precios", cat:"Precios y Rentabilidad", ico:"🏷️", titulo:"Costos y Rentabilidad", desc:"Costo, escalera de precios por cantidad y margen por tramo, con salud por color. Para definir y analizar los precios.", roles:["finanzas"], ready:true, path:()=>"comercial/precios.html"},
    {key:"config-precios", dept:"precios", cat:"Precios y Rentabilidad", ico:"⚙️", titulo:"Motor de precios", desc:"Reglas del motor por categoría: recargo, cortes, descuentos, IVA al costo y piso de margen. Las ofertas se crean en Oportunidades y Ofertas.", roles:["finanzas"], ready:true, path:()=>"comercial/config-precios.html"},
    {key:"cobranzas", dept:"finanzas", cat:"Administración", ico:"💳", titulo:"Cobranzas", desc:"Deuda por cliente con antigüedad (+30/+60/+90/+120) para reclamar y detectar incobrables.", roles:["finanzas","cobranzas"], ready:true, path:()=>"finanzas/cobranzas.html"},
    /* EN PRUEBAS: legajos de clientes (documentación de alta). Lo gestiona Administración
       (Vanesa/Bárbara). Oculto al equipo hasta liberarlo: se le da acceso puntual por persona
       (modulos_extra) desde "Usuarios y accesos", o se borra la línea `pruebas` de acá y el
       {pruebas:…} del EYG.guard() de finanzas/legajos.html para abrirlo a los roles. */
    {key:"legajos", dept:"finanzas", cat:"Administración", ico:"📁", titulo:"Legajos de clientes", desc:"Documentación de alta de cada cliente: habilitación sanitaria y constancia de CUIT, con vencimientos y estado a simple vista. Los archivos quedan pegados al contacto.", roles:["finanzas","cobranzas","admin","direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"finanzas/legajos.html"},
    /* EN PRUEBAS: consulta crediticia por CUIT (Central de Deudores del BCRA, fuente pública/gratis).
       La página le pega directo al BCRA (no usa Supabase). Gateada al super-admin hasta revisarla.
       Para liberarla: borrar la línea `pruebas` de acá y el {pruebas:…} del EYG.guard() de finanzas/situacion-crediticia.html. */
    {key:"credito", dept:"finanzas", cat:"Administración", ico:"🔎", titulo:"Situación crediticia", desc:"Consultá por CUIT la deuda en bancos, cheques rechazados y el historial de 2 años, directo del BCRA. Para decidir beneficios de pago sin pagar Veraz/Nosis.", roles:["finanzas","direccion","comercial","lider"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"finanzas/situacion-crediticia.html"},
    /* EN PRUEBAS: módulo de Egresos (espejo de Cobranzas). Oculto para todo el equipo
       hasta terminarlo — sólo la huella del dueño. Para liberarlo: borrar la línea
       `pruebas` de acá y el {pruebas:…} del EYG.guard() de finanzas/egresos.html. */
    {key:"egresos", dept:"finanzas", cat:"Administración", ico:"💸", titulo:"Egresos", desc:"Todo lo que sale: compras de mercadería, gastos operativos, financieros, impuestos y pagos a proveedores. El panorama del egreso, por naturaleza y por proveedor.", roles:["finanzas","direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"finanzas/egresos.html"},
    /* EN PRUEBAS: herramienta para cargar préstamos bancarios (comprobantes OC-X) en Odoo.
       Gateada al super-admin hasta terminarla. */
    {key:"creditos-banc", dept:"finanzas", cat:"Administración", ico:"🏦", titulo:"Cargar crédito bancario", desc:"Cargá los préstamos que pedís a los bancos: pegás el PDF del banco y el neto acreditado, y genera el comprobante OC-X en Odoo con capital, interés, sellados, IVA y todas las cuotas.", roles:["finanzas","direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"finanzas/creditos-bancarios.html"},
    {key:"stock",     dept:"compras", cat:"Compras", ico:"📦", titulo:"Stock, Compras y Reposición", desc:"Qué conviene comprar y cuándo, pedido por proveedor (borrador en Odoo), productos ganadores, sobrestock y vencimientos. Con tarjeta de salud del abastecimiento.", roles:["finanzas","inventario"], ready:true, path:()=>"inventario/stock.html"},
    {key:"nombres",   dept:"deposito", cat:"Depósito", ico:"🏷️", titulo:"Maestro de productos", desc:"Ordená el dato maestro de cada producto: nombre, unidades, embalaje y subcategoría. Detecta errores y completa lo que falta, con un clic.", roles:["inventario","maestro"], ready:true, path:()=>"inventario/nombres.html"},
    {key:"deposito-control", dept:"deposito", cat:"Depósito", ico:"🩺", titulo:"Control de Depósito", desc:"Saneá el depósito: contá y ajustá el stock físico, corregí la valuación torcida, completá costos faltantes y limpiá archivados y basura. Deja el inventario fiel a la realidad.", roles:["inventario","maestro"], ready:true, path:()=>"inventario/control.html"},
    {key:"oportunidades", dept:"compras", cat:"Compras", ico:"💡", titulo:"Oportunidades y Ofertas", desc:"Cuando un costo baja, el sistema detecta una oportunidad de oferta. Confirmala (precio, stock, vigencia) o armá combos, y van a la tarjeta de los comerciales.", roles:["inventario"], ready:true, path:()=>"inventario/oportunidades.html"},
    {key:"pendientes", dept:"compras", cat:"Compras", ico:"📋", titulo:"Pendientes de reposición", desc:"Lo que los clientes pidieron y no había stock: qué reponer y para quién. Los comerciales cargan el faltante al vender; dirección y compras lo gestionan hasta reponerlo.", roles:["direccion","finanzas","inventario","comercial","lider","admin","maestro"], ready:true, path:()=>"inventario/pendientes.html"},
    /* EN PRUEBAS: CRM de contactos (existentes + por conquistar). Oculto para todo
       el equipo hasta terminarlo — sólo super-admins (Diego/German). Para liberarlo:
       borrar la línea `pruebas` de acá y el {pruebas:…} del EYG.guard() de datos/contactos.html. */
    /* EN PRUEBAS: sólo super-admins (Diego/German). Desde acá German/Diego envían prospectos
       del padrón a la carpeta "A conquistar" de cada comercial. Marcela (líder) NO accede. */
    {key:"contactos", dept:"comercial", cat:"Comercial", ico:"👥", titulo:"Clientes (CRM)", desc:"Gestioná los contactos del equipo, cruzá con el padrón oficial y enviá prospectos a la carpeta 'A conquistar' de cada comercial.", roles:["comercial","lider","admin","direccion"], ready:true,
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
    /* EN PRUEBAS: el mapa vivo del sistema (registro maestro / ley). Sólo super-admins
       hasta liberarlo: borrar la línea `pruebas` de acá y el {pruebas:…} del
       EYG.guard() de direccion/mapa.html. */
    {key:"mapa", dept:"direccion", cat:"Dirección", ico:"🧠", titulo:"Mapa del sistema", desc:"El sistema entero en 3D: Odoo en el núcleo, los módulos del Core alrededor, Supabase, GitHub y la web, con cada conexión y cada fórmula nuestra. Es ley: todo cambio se registra acá.", roles:["direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"direccion/mapa.html"},
    /* EN PRUEBAS: el Asistente EyG (superagente, Fase 1). Chat con IA conectado a
       Odoo (solo lectura), al buscador del catálogo y a la web. Los precios y el
       stock salen SIEMPRE de Odoo. Cerebro: edge function eyg-agente (Supabase).
       Para liberarlo: borrar la línea `pruebas` de acá y el {pruebas:…} del
       EYG.guard() de direccion/agente.html, y ampliar roles si hace falta. */
    {key:"agente", dept:"direccion", cat:"Dirección", ico:"✨", titulo:"Asistente EyG", desc:"El experto interno en un HUD en vivo: preguntale por ventas, precios, stock, clientes o deuda y consulta Odoo al instante, mostrando el conocimiento que va adquiriendo. La web solo para lo externo, citando fuente.", roles:["direccion"], ready:true,
      pruebas:["a3dfd1b309dd41ad2c8ae3562a8e00c09ae03f8dd8194b75eea5a3db5c003122"],
      path:()=>"direccion/agente.html"},
    {key:"usuarios",  dept:"admin", cat:"Sistema", ico:"👤", titulo:"Usuarios y accesos", desc:"Altas de personal, roles y permisos por persona (qué módulos ve cada uno). Restablecé contraseñas por mail.", roles:["admin"], ready:true, path:()=>"admin/usuarios.html"},
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
    /* Permisos POR PERSONA (los asigna el módulo "Usuarios y accesos"). Se
       resuelven ANTES que el candado "en pruebas": una concesión explícita
       (modulos_extra) habilita el módulo aunque esté en pruebas o no sea de su
       rol; una quita (modulos_quita) lo saca aunque el rol lo traiga. */
    if((p.modulos_quita||[]).includes(m.key)) return false;
    if((p.modulos_extra||[]).includes(m.key)) return true;
    /* WhatsApp para comerciales y líderes: lo gobierna el interruptor
       core_config.wsp_comerciales, y adentro es de solo lectura y recortado a
       sus clientes por el servidor. Pasa por encima del candado "en pruebas"
       a propósito: el interruptor es el que manda. */
    const wspOk = m.key==="whatsapp" && p._cfg && p._cfg.wsp_comerciales===true
                  && (p.rol==="comercial" || p.rol==="lider" || p.rol==="cobranzas");
    if(wspOk) return true;
    if(p.rol==="comercial") return m.key==="panel";   // comercial: sólo su panel (salvo concesión explícita, ya resuelta arriba)
    if(m.pruebas && m.pruebas.length && !m.pruebas.includes(p._h)) return false;
    if(p.rol==="admin"||p.rol==="direccion") return true;
    return m.roles.includes(p.rol);
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
    /* Módulos "kiosco" (pantalla completa, chrome propio) se bajan del riel con
       <body data-eyg-rail="no">. Sin esto, el rail se lleva el body ANTES de que
       el módulo arme su pantalla, y ésta queda fuera de la vista: el admin ve
       negro. Le pasó al Tablero en vivo. */
    if(document.body.getAttribute("data-eyg-rail")==="no") return;
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

  /* ---- Stock real de las ofertas ----
     Una oferta cuyo producto se quedo sin stock se APAGA SOLA: desaparece del panel de los
     comerciales (y del inicio y la tarjeta del lider) y queda en gris "Agotada" en el modulo
     Oportunidades y Ofertas, para reponer stock o eliminarla. Al reponer, revive sola.
     Devuelve {idVariante: qty_available}, o null si Odoo no respondio — en ese caso NO se
     filtra nada (mejor mostrar una oferta agotada que esconder todas por un error de red). */
  async function ofStockMap(pids){
    const ids=[...new Set((pids||[]).filter(Boolean))];
    if(!ids.length) return {};
    try{
      const rows=await rpc("product.product","read",[ids,["qty_available"]]);
      const m={}; (rows||[]).forEach(r=>{ m[r.id]=r.qty_available||0; });
      return m;
    }catch(e){ return null; }
  }
  /* Agotada = algun producto de la oferta sin stock (un combo no se entrega si le falta una parte). */
  function ofAgotada(o,map){
    if(!map) return false;
    const its=((o&&o.items)||[]).filter(i=>i&&i.id);
    if(!its.length) return false;
    return its.some(i=>(map[i.id]||0)<=0);
  }

  /* ---- Tarjeta "Combos y ofertas de la semana" (compartida: panel comercial + lider) ----
     Lee las ofertas activas del parametro eyg.ofertas (las carga el modulo Oportunidades). */
  // CSS de las tarjetas de oferta del líder (incluye el 🔥 latiendo). Se inyecta 1 vez.
  function ofStyles(){
    if(typeof document==="undefined"||document.getElementById("eyg-lof-css")) return;
    const s=document.createElement("style"); s.id="eyg-lof-css"; s.textContent=
    ".lofbox{background:linear-gradient(135deg,#04635F,#048782);border-radius:16px;padding:15px 16px;margin:14px 0}"+
    ".lof-head{color:#fff;font-weight:800;font-size:16px;margin-bottom:11px}.lof-head span{opacity:.8;font-weight:600;font-size:12px}"+
    ".lof-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:11px;align-items:stretch}"+
    ".lof-card{background:#fff;border-radius:12px;padding:12px 13px;box-shadow:0 2px 10px rgba(0,0,0,.08);display:flex;flex-direction:column;border:1px solid transparent}"+
    ".lof-card.hot{border-color:#F0B15A;box-shadow:0 0 0 1px #F0B15A,0 6px 18px rgba(255,140,60,.18)}"+
    ".lof-tag{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#048782}"+
    ".lof-name{font-weight:800;font-size:14px;color:#0E1F1D;margin:3px 0;line-height:1.25;min-height:34px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}"+
    ".lof-prod{font-size:11px;color:#8A9A97;min-height:15px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}"+
    ".lof-price{display:flex;align-items:baseline;gap:7px;margin:6px 0 4px;min-height:24px}.lof-old{color:#8A9A97;text-decoration:line-through;font-size:12px}.lof-new{color:#1E7D46;font-weight:900;font-size:18px}.lof-off{background:#e7f6ec;color:#1E7D46;font-weight:800;font-size:11px;border-radius:20px;padding:1px 7px}"+
    ".lof-perf{display:flex;gap:5px;flex-wrap:wrap;margin:2px 0}.lof-perf span{background:#F1F5F4;border-radius:20px;padding:2px 8px;font-size:10.5px;font-weight:700;color:#5F716E;white-space:nowrap}.lof-perf b{color:#0E1F1D}"+
    ".lof-rend.alta{background:#E4F5E9;color:#1E7D46}.lof-rend.media{background:#FBF0DA;color:#9A6B12}.lof-rend.baja{background:#F1F5F4;color:#8A9A97}"+
    ".lof-extra{font-size:10.5px;color:#8A9A97;margin-top:4px;min-height:14px}"+
    ".lof-hot{margin-top:auto;padding-top:8px;font-size:11px;font-weight:800;color:#B45816}"+
    ".of-fire{display:inline-block;animation:ofFire 1.15s ease-in-out infinite;transform-origin:center}"+
    "@keyframes ofFire{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0 rgba(255,140,60,0))}50%{transform:scale(1.25);filter:drop-shadow(0 0 7px rgba(255,140,60,.8))}}"+
    "@media(prefers-reduced-motion:reduce){.of-fire{animation:none}}";
    document.head.appendChild(s);
  }
  async function cardOfertasSemana(elId){
    const el = document.getElementById(elId); if(!el) return;
    ofStyles();
    let ofertas=[];
    try{ const raw = await rpc("ir.config_parameter","get_param",["eyg.ofertas"]); ofertas = JSON.parse(raw||"[]"); }catch(e){ return; }
    const hoy = new Date().toISOString().slice(0,10);
    let act = ofertas.filter(o=>o && o.id && (!o.hasta || o.hasta>=hoy));
    // sin stock = no se ofrece: la oferta se apaga sola (queda gris en Oportunidades y Ofertas)
    const sm = await ofStockMap(act.flatMap(o=>((o.items)||[]).map(i=>i&&i.id)));
    if(sm) act = act.filter(o=>!ofAgotada(o,sm));
    if(!act.length){ el.innerHTML=""; return; }
    // Rendimiento GLOBAL por oferta (todos los comerciales), igual criterio que el panel del comercial.
    const d120 = new Date(Date.now()-120*864e5).toISOString().slice(0,10);
    const stat={};
    try{
      const allEnv = await rpc("mail.message","search_read",[[["model","=","res.partner"],["body","like","EyGOFENV"],["date",">=",d120+" 00:00:00"]]],{fields:["body"],limit:0});
      const envTexts = allEnv.map(m=>(m.body||"").replace(/<[^>]+>/g,""));
      await Promise.all(act.map(async o=>{
        const pids=(o.items||[]).map(i=>i.id).filter(Boolean);
        const tit=o.titulo || (o.items||[]).map(i=>i.nombre).join(" + ");
        const env = tit ? envTexts.filter(b=>b.includes(tit)).length : 0;
        let ven=0;
        if(pids.length){ const desde=(o.creada||(d120+" 00:00:00")), hasta=(o.hasta||hoy);
          try{ const g=await rpc("sale.order.line","read_group",[[["product_id","in",pids],["state","in",["sale","done"]],["order_id.date_order",">=",desde],["order_id.date_order","<=",hasta+" 23:59:59"]],["__count"],["order_partner_id"]],{lazy:false}); ven=g.length; }catch(e){} }
        stat[o.id]={env,ven,conv:env>0?ven/env:0, score:(env>0?ven/env:0)*100+ven};
      }));
    }catch(e){}
    // Las mejores: hasta 4 con ventas reales, ordenadas por rendimiento. Llevan la llamita.
    const hotIds=new Set(act.map(o=>({id:o.id,s:stat[o.id]||{}})).filter(x=>(x.s.ven||0)>=1)
      .sort((a,b)=>(b.s.score||0)-(a.s.score||0)).slice(0,4).map(x=>x.id));
    const esHot=o=>hotIds.has(o.id);
    // Orden: primero las mejores (por rendimiento), después las nuevas/resto (orden original).
    act.sort((a,b)=>{ const ha=hotIds.has(a.id), hb=hotIds.has(b.id);
      if(ha!==hb) return ha?-1:1;
      if(ha&&hb) return ((stat[b.id]||{}).score||0)-((stat[a.id]||{}).score||0);
      return 0; });
    const fD=s=>s?(s.slice(8,10)+"/"+s.slice(5,7)):"";
    const card=o=>{
      const items=(o.items||[]).map(i=>i.nombre).join(" + ");
      const ah=(o.precioAntes>o.precio)?Math.round((1-o.precio/o.precioAntes)*100):0;
      const s=stat[o.id]||{env:0,ven:0}; const hot=esHot(o); const rendPct=s.env>0?Math.round(s.conv*100):null;
      const rc=rendPct==null?'':(rendPct>=40?'alta':rendPct>=15?'media':'baja');
      return `<div class="lof-card${hot?' hot':''}">
        <div class="lof-tag">${o.tipo==='combo'?'🎁 Combo':'🏷️ Oferta'}${o.hasta?' · hasta '+fD(o.hasta):''}</div>
        <div class="lof-name">${esc(o.titulo||items)}</div>
        <div class="lof-prod">${(o.titulo&&items&&items!==o.titulo)?esc(items):'&nbsp;'}</div>
        <div class="lof-price">${o.precioAntes>o.precio?`<span class="lof-old">${money(o.precioAntes)}</span>`:""}<span class="lof-new">${money(o.precio)}</span>${ah?`<span class="lof-off">−${ah}%</span>`:""}</div>
        <div class="lof-perf" title="Rendimiento en toda la droguería (120 días)"><span>📤 <b>${s.env}</b></span><span>🛒 <b>${s.ven}</b></span>${rendPct!=null?`<span class="lof-rend ${rc}">${rendPct}%</span>`:''}</div>
        <div class="lof-extra">${o.stock?('📦 '+o.stock+' disp.'+(o.nota?' · 📝 '+esc(o.nota):'')):(o.nota?('📝 '+esc(o.nota)):'&nbsp;')}</div>
        ${hot?'<div class="lof-hot"><span class="of-fire">🔥</span> Mejor rendimiento — ofrecela</div>':''}
      </div>`;
    };
    el.innerHTML = `<div class="lofbox"><div class="lof-head">🏷️ Combos y ofertas de la semana <span>· ${act.length}</span></div>
      <div class="lof-grid">${act.map(card).join("")}</div></div>`;
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

  /* Crea una NOVEDAD (aparece en la campanita) dirigida a los usuarios con esos roles.
     Usa el roster del Core para resolver emails y la manda por alcance personas. */
  async function notificarRoles(roles, opts){
    opts=opts||{}; roles=roles||[];
    let emails=[];
    try{ const r=await rosterCore(); emails=(r||[]).filter(u=>roles.includes(u.rol)).map(u=>(u.email||"").toLowerCase()).filter(Boolean); }catch(e){}
    emails=[...new Set(emails)];
    if(!emails.length) return false;
    const arr=await comsLeer();
    arr.push({ id:"nv_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6),
      clase:"novedad", alcance:"personas", personas:emails,
      titulo:opts.titulo||"Novedad", cuerpo:opts.cuerpo||"", autor:opts.autor||"Sistema",
      prioridad:opts.prioridad||"", ts:new Date().toISOString(), activo:true, leidoPor:[] });
    await comsGuardar(arr); return true;
  }
  /* ===== Organigrama (hr.employee.parent_id) para acotar por equipo ===== */
  const _normNom = s => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  let _org=null;
  async function orgCargar(force){
    if(_org && !force) return _org;
    try{ const e=await rpc("hr.employee","search_read",[[]],{fields:["id","name","parent_id"]}); _org=(e||[]).map(x=>({name:x.name, parent:x.parent_id?x.parent_id[1]:null})); }
    catch(e){ _org=[]; }
    return _org;
  }
  function _empByName(org,nombre){ const n=_normNom(nombre); return org.find(x=>_normNom(x.name)===n)||null; }
  // Nombres del subárbol de `nombre` (subordinados directos e indirectos; sin incluirlo).
  async function orgDescendientes(nombre){
    const org=await orgCargar(); const start=_empByName(org,nombre); const out=new Set(); if(!start) return out;
    let front=[start.name], guard=0;
    while(front.length && guard++<20){ const fn=front.map(_normNom), next=[];
      org.forEach(x=>{ if(x.parent && fn.includes(_normNom(x.parent)) && !out.has(x.name)){ out.add(x.name); next.push(x.name); } });
      front=next; }
    return out;
  }
  // Nombres de los jefes hacia arriba (líder directo y sus superiores).
  async function orgAncestros(nombre){
    const org=await orgCargar(); let cur=_empByName(org,nombre); const out=[]; let guard=0;
    while(cur && cur.parent && guard++<10){ out.push(cur.parent); cur=_empByName(org,cur.parent); }
    return out;
  }
  /* Notifica (campanita) a los LÍDERES del comercial (su cadena de jefes del organigrama).
     Así el descarte de un comercial sólo le llega a SUS líderes, no a los de otros equipos. */
  async function notificarLideresDe(nombreComercial, opts){
    const anc=await orgAncestros(nombreComercial);
    let emails=[];
    try{ const r=await rosterCore(); emails=(r||[]).filter(u=>anc.some(a=>_normNom(a)===_normNom(u.nombre))).map(u=>(u.email||"").toLowerCase()).filter(Boolean); }catch(e){}
    emails=[...new Set(emails)];
    if(!emails.length) return false;
    opts=opts||{};
    const arr=await comsLeer();
    arr.push({ id:"nv_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6),
      clase:"novedad", alcance:"personas", personas:emails,
      titulo:opts.titulo||"Novedad", cuerpo:opts.cuerpo||"", autor:opts.autor||"Sistema",
      prioridad:opts.prioridad||"", ts:new Date().toISOString(), activo:true, leidoPor:[] });
    await comsGuardar(arr); return true;
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
    .eyg-bell-badge{position:absolute;top:-1px;right:-1px;min-width:16px;height:16px;padding:0 4px;background:#EC5E4F;color:#fff;font-size:10px;font-weight:800;border-radius:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px rgba(0,0,0,.12);z-index:2}
    /* Onda sonora que sale de la campanita cuando hay notificaciones (llama la atención) */
    .eyg-bell-ripple{position:absolute;left:50%;top:52%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:2px solid rgba(236,94,79,.6);pointer-events:none;z-index:0;animation:eygBellRing 1.9s ease-out infinite}
    .eyg-bell-ripple.d2{animation-delay:.95s}
    .eyg-bell-wrap.has-notif .eyg-bell-btn{animation:eygBellSwing 1.9s ease-in-out infinite;transform-origin:top center}
    @keyframes eygBellRing{0%{transform:scale(.5);opacity:.65}70%{opacity:.12}100%{transform:scale(2.7);opacity:0}}
    @keyframes eygBellSwing{0%,60%,100%{transform:rotate(0)}68%{transform:rotate(11deg)}76%{transform:rotate(-9deg)}84%{transform:rotate(6deg)}92%{transform:rotate(-3deg)}}
    @media(prefers-reduced-motion:reduce){.eyg-bell-ripple,.eyg-bell-wrap.has-notif .eyg-bell-btn{animation:none}}
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
    mount.innerHTML=`<div class="eyg-bell-wrap${nBadge?' has-notif':''}">
      ${nBadge?'<span class="eyg-bell-ripple"></span><span class="eyg-bell-ripple d2"></span>':''}
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
        ${c.link?`<button class="pri" onclick="EYG.comCerrarOverlay();location.href=EYG.abs('${esc(c.link)}')">${esc(c.linkLabel||'Ir →')}</button>`:''}
        <button class="${c.link?'':'pri'}" onclick="EYG.comCerrarOverlay()">Cerrar</button>
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

  /* ===== SITUACIÓN CREDITICIA (BCRA) — helpers compartidos + CACHE por CUIT =====
     Mismo semáforo que el módulo "Situación crediticia" (ponderado por monto). Se usa en el
     badge de la lista de contactos y en la ficha. CACHE compartida en ir.config_parameter
     `eyg.bcra` (mapa CUIT→resumen): el badge aparece al instante y no re-consulta a cada rato;
     se refresca si está viejo. "Ligada al contacto" = keyed por su CUIT (la ve comercial y líder). */
  const BCRA_URL="https://api.bcra.gob.ar/centraldedeudores/v1.0";
  const BCRA_KEY="eyg.bcra";
  async function bcraTraer(path){ const r=await fetch(BCRA_URL+path,{headers:{Accept:"application/json"}}); if(r.status===404) return null; if(!r.ok) throw new Error("BCRA "+r.status); return (await r.json()).results||null; }
  async function bcraFull(cuit){ const c=(cuit||"").replace(/\D/g,""); if(c.length!==11) return null;
    const [deudas,historicas,cheques]=await Promise.all([ bcraTraer("/Deudas/"+c), bcraTraer("/Deudas/Historicas/"+c).catch(()=>null), bcraTraer("/Deudas/ChequesRechazados/"+c).catch(()=>null) ]);
    return {deudas,historicas,cheques}; }
  function bcraClasificar(data){
    const {deudas,historicas,cheques}=data||{};
    const actual=(deudas&&deudas.periodos&&deudas.periodos[0])||(historicas&&historicas.periodos&&historicas.periodos[0])||null;
    const nombre=(deudas&&deudas.denominacion)||(historicas&&historicas.denominacion)||(cheques&&cheques.denominacion)||"";
    const peor=ents=>(ents||[]).reduce((m,e)=>(e.situacion>0&&e.situacion>m)?e.situacion:m,0);
    let chDet=[],chImpagos=0;
    if(cheques&&cheques.causales){ cheques.causales.forEach(x=>(x.entidades||[]).forEach(en=>(en.detalle||[]).forEach(d=>{ chDet.push({entidad:en.entidad||x.causal||"",...d}); if(!d.fechaPago) chImpagos++; }))); }
    const hayCheques=chDet.length>0;
    if(!actual && !cheques){ return {luz:"g",sin:true,est:"Sin registros",nombre,expli:"No figura con deuda en el sistema financiero ni cheques rechazados en el BCRA. Puede no tener productos bancarios.",deuda:0,irreg:0,pctIrreg:0,cheques:0,chImpagos:0,ws:0,ents:[],chDet:[],historicas:null,periodo:null}; }
    const ents=((actual&&actual.entidades)||[]).filter(e=>e.situacion>0||e.monto>0);
    const ws=peor(ents);
    const totalMiles=ents.reduce((a,e)=>a+(e.monto||0),0);
    const irregEnts=ents.filter(e=>e.situacion>=3);
    const irregMiles=irregEnts.reduce((a,e)=>a+(e.monto||0),0);
    const wsIrreg=peor(irregEnts);
    const pctIrreg=totalMiles>0?irregMiles/totalMiles:(irregEnts.length?1:0);
    const legalEnts=ents.filter(e=>e.procesoJud||e.situacionJuridica);
    const legalMaterial=legalEnts.some(e=> totalMiles>0 ? (e.monto/totalMiles)>=0.10 : true);
    let luz="g",est="Apto",expli="";
    if(chImpagos>0||pctIrreg>=0.10||legalMaterial){ luz="r"; est="Revisar con cuidado"; const mot=[]; if(pctIrreg>=0.10) mot.push("parte de su deuda está en situación "+wsIrreg); if(chImpagos>0) mot.push(chImpagos+" cheque"+(chImpagos>1?"s":"")+" impago"+(chImpagos>1?"s":"")); if(legalMaterial) mot.push("proceso judicial"); expli="Presenta "+mot.join(", ")+". Conviene revisar antes de otorgar beneficios de pago (ej. cheque a 120 días)."; }
    else if(irregMiles>0||ws===2||hayCheques||legalEnts.length){ luz="y"; est="Con reparos"; expli="Mayormente en orden, con alguna marca menor. Se puede avanzar con criterio."; }
    else { luz="g"; est="Apto"; expli=ents.length?"Toda su deuda en situación normal, sin cheques rechazados. Buen perfil para beneficios de pago.":"Sin irregularidades en el BCRA."; }
    return {luz,sin:false,est,nombre,expli,deuda:totalMiles*1000,irreg:irregMiles*1000,pctIrreg,cheques:chDet.length,chImpagos,ws,wsIrreg,hayCheques,ents,chDet,historicas,periodo:actual&&actual.periodo};
  }
  /* Resumen LITE para badge/cache (2 endpoints: Deudas + Cheques). */
  async function bcraResumen(cuit){ const c=(cuit||"").replace(/\D/g,""); if(c.length!==11) return null;
    try{ const [deudas,cheques]=await Promise.all([ bcraTraer("/Deudas/"+c), bcraTraer("/Deudas/ChequesRechazados/"+c).catch(()=>null) ]);
      const s=bcraClasificar({deudas,historicas:null,cheques});
      return {luz:s.luz,sin:s.sin,est:s.est,deuda:Math.round(s.deuda),irreg:Math.round(s.irreg),cheques:s.cheques,chImpagos:s.chImpagos,ws:s.ws,nombre:s.nombre};
    }catch(e){ return {error:e.message}; }
  }
  async function bcraCacheLeer(){ try{ return JSON.parse(await rpc("ir.config_parameter","get_param",[BCRA_KEY])||"{}")||{}; }catch(e){ return {}; } }
  async function bcraCacheMerge(obj){ if(!obj||!Object.keys(obj).length) return; try{ const cur=await bcraCacheLeer(); Object.assign(cur,obj); await rpc("ir.config_parameter","set_param",[BCRA_KEY,JSON.stringify(cur)]); }catch(e){} }
  function bcraStyles(){ if(typeof document==="undefined"||document.getElementById("eyg-bcra-css")) return; const s=document.createElement("style"); s.id="eyg-bcra-css"; s.textContent=".eyg-bcra{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:20px;white-space:nowrap}.eyg-bcra .pt{width:7px;height:7px;border-radius:50%;background:currentColor}.eyg-bcra.g{background:#E4F5E9;color:#1E7D46}.eyg-bcra.y{background:#FBF0DA;color:#9A6B12}.eyg-bcra.r{background:#FBE4E3;color:#B0322F}.eyg-bcra.load{background:#eef3f2;color:#8A9A97}"; document.head.appendChild(s); }
  /* Badge para la lista: r=undefined → "consultando"; r.error → nada. */
  function badgeBCRA(r){ bcraStyles(); if(r===null) return ""; if(!r) return '<span class="eyg-bcra load" title="Consultando situación crediticia (BCRA)…"><span class="pt"></span>crédito…</span>'; if(r.error) return ""; const luz=r.luz||"g"; const t=r.sin?"Apto · sin deuda":(luz==="g"?"Apto":luz==="y"?"Con reparos":"Revisar"); return `<span class="eyg-bcra ${luz}" title="Situación crediticia BCRA: ${esc(r.est||t)}${r.chImpagos?(' · '+r.chImpagos+' cheque(s) impago(s)'):''}"><span class="pt"></span>${t}</span>`; }

  /* ===== VEREDICTO DE CRÉDITO (para el comercial) =====
     Cruza TODAS las fuentes (como la evaluación de Cobranzas): externo (BCRA: situación,
     cheques, judicial) + interno (historial de pago con EyG: vencido, mora, incobrable/marca).
     Devuelve UN resultado simple (sin desglose): apto · reparos · consultar · noapto. Aplica a
     CUALQUIER beneficio (plazos de pago, cheque, etc.). El umbral para "consultar con Cobranzas"
     es CONFIGURABLE en ir.config_parameter `eyg.credito` (moraConsultar/moraNoApto/vencidoMin):
     Cobranzas ajusta desde dónde debe intervenir, porque es quien define tras una evaluación
     más profunda. El comercial solo ve el veredicto; el detalle vive en el módulo de Cobranzas. */
  const CRED_KEY="eyg.credito";
  let _credCfg=null;
  async function creditoConfig(force){ if(_credCfg && !force) return _credCfg; let o={}; try{ o=JSON.parse(await rpc("ir.config_parameter","get_param",[CRED_KEY])||"{}")||{}; }catch(e){} _credCfg=Object.assign({moraConsultar:30, moraNoApto:90, vencidoMin:1000}, o); return _credCfg; }
  const CRED_NIV={
    apto:     {luz:"g", chip:"Apto",       titulo:"Apto",                    sub:"Apto para otorgar beneficios de pago (plazos, cheques, etc.)."},
    reparos:  {luz:"y", chip:"Con reparos", titulo:"Apto con reparos",        sub:"Podés otorgar beneficios de pago, con criterio."},
    consultar:{luz:"o", chip:"Consultar",  titulo:"Consultar con Cobranzas", sub:"Antes de otorgar un beneficio de pago (plazo, cheque), consultá con Cobranzas."},
    noapto:   {luz:"r", chip:"No apto",     titulo:"No apto",                 sub:"No conviene otorgar beneficios de pago (plazos, cheques) por ahora."},
  };
  function _cred(nivel,mot){ const m=CRED_NIV[nivel]; return {nivel, luz:m.luz, titulo:m.titulo, sub:m.sub, motivo:(mot||[]).join(" · ")}; }
  /* interno = fila de riesgoCartera(): {nivel:'ok'|'atencion'|'alto', vencido, mora, bovIncobrable, manual}. */
  function evalCredito(bcra, interno, cfg){
    cfg=cfg||_credCfg||{moraConsultar:30, moraNoApto:90, vencidoMin:1000};
    const iv=interno||{}, mora=iv.mora||0, venc=iv.vencido||0, vmin=cfg.vencidoMin||1000;
    const incob=!!(iv.bovIncobrable||iv.manual);
    const b=bcra||{}, chImp=(b.chImpagos||0)>0, bR=b.luz==="r", bY=b.luz==="y";
    // No apto — señales fuertes
    if(incob) return _cred("noapto",[iv.manual?"marcado con problemas de pago":"marcado incobrable en Cobranzas"]);
    if(chImp) return _cred("noapto",["cheques rechazados sin pagar"]);
    if(venc>vmin && mora>=cfg.moraNoApto) return _cred("noapto",["deuda muy atrasada con EyG"]);
    // Consultar con Cobranzas — señales medias (umbral configurable)
    const mc=[];
    if(bR) mc.push("situación irregular en el sistema financiero");
    if(venc>vmin && mora>=cfg.moraConsultar) mc.push("registra atrasos de pago con EyG");
    if(mc.length) return _cred("consultar",mc);
    // Apto con reparos — marcas menores
    const mr=[];
    if(bY) mr.push("alguna marca menor en el BCRA");
    if(venc>vmin && mora>0) mr.push("atraso leve de pago");
    if(mr.length) return _cred("reparos",mr);
    // Apto
    return _cred("apto",[]);
  }
  function credStyles(){ if(typeof document==="undefined"||document.getElementById("eyg-cred-css")) return; const s=document.createElement("style"); s.id="eyg-cred-css"; s.textContent=".eyg-cred{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:20px;white-space:nowrap}.eyg-cred .pt{width:7px;height:7px;border-radius:50%;background:currentColor}.eyg-cred.g{background:#E4F5E9;color:#1E7D46}.eyg-cred.y{background:#FBF0DA;color:#9A6B12}.eyg-cred.o{background:#FBE3D4;color:#B45816}.eyg-cred.r{background:#FBE4E3;color:#B0322F}.eyg-cred.load{background:#eef3f2;color:#8A9A97}"+
    ".eyg-credleg{display:flex;flex-direction:column;gap:7px;background:#F4F8F7;border:1px solid #DCE8E6;border-radius:10px;padding:11px 13px}.eyg-credleg .cl-row{display:flex;gap:9px;align-items:flex-start;font-size:12px;color:#3a4a47;line-height:1.35}.eyg-credleg .cl-dot{width:11px;height:11px;border-radius:50%;flex:none;margin-top:2px}.eyg-credleg .cl-dot.g{background:#1E7D46}.eyg-credleg .cl-dot.y{background:#B7791F}.eyg-credleg .cl-dot.o{background:#C4602A}.eyg-credleg .cl-dot.r{background:#B0322F}.eyg-credleg b{color:#0E1F1D}"; document.head.appendChild(s); }
  function badgeCredito(v){ credStyles(); if(!v) return ""; if(v.loading) return '<span class="eyg-cred load" title="Evaluando…"><span class="pt"></span>evaluando…</span>'; return `<span class="eyg-cred ${v.luz}" title="Evaluación para beneficios: ${esc(v.titulo)}${v.motivo?(' — '+esc(v.motivo)):''}"><span class="pt"></span>${esc(v.titulo)}</span>`; }
  /* Leyenda de los 4 niveles (qué significa cada uno). Reutilizable en cualquier módulo. */
  function credLeyendaHTML(){ credStyles(); return '<div class="eyg-credleg">'+["apto","reparos","consultar","noapto"].map(k=>{const m=CRED_NIV[k]; return `<div class="cl-row"><span class="cl-dot ${m.luz}"></span><div><b>${esc(m.titulo)}</b> — ${esc(m.sub)}</div></div>`;}).join("")+'</div>'; }

  /* ===== CONTACTOS A CONQUISTAR (bolsillo del comercial) =====
     El líder asigna establecimientos del padrón oficial (módulo Contactos) a la carpeta de un
     comercial para que los trabaje y los convierta en clientes nuevos. Se guardan los DATOS del
     ítem (no el idx del padrón, que no existe fuera de Contactos) en ir.config_parameter
     `eyg.conquistar`: [{id, com(comercial_ref), nombre, tipo(0 farmacia/1 institución), loc, prov,
     dom, por(asignó), ts, partnerId(null hasta que el comercial lo crea)}]. El estado se DERIVA:
     sin partnerId=pendiente; con partnerId=creado; convertido cuando la ficha llega a 90% + mensaje
     inicial (lo evalúa el panel con los datos vivos del contacto). */
  const CONQ_KEY="eyg.conquistar";
  async function conquistarLeer(){ try{ return JSON.parse(await rpc("ir.config_parameter","get_param",[CONQ_KEY])||"[]")||[]; }catch(e){ return []; } }
  async function conquistarGuardar(arr){ return rpc("ir.config_parameter","set_param",[CONQ_KEY, JSON.stringify(arr||[])]); }
  const _cqKey=it=>((it.nombre||"")+"|"+(it.loc||"")).toLowerCase().replace(/\s+/g," ").trim();
  /* Asigna ítems a la carpeta de un comercial (por su nombre/ref). Evita duplicar el mismo
     establecimiento (nombre+localidad) en la misma carpeta si sigue pendiente. Devuelve cuántos entraron. */
  async function conquistarAsignar(items, comRef, por){
    const arr=await conquistarLeer();
    const yaKeys=new Set(arr.filter(x=>x&&x.com===comRef&&!x.partnerId).map(_cqKey));
    let n=0;
    (items||[]).forEach(it=>{ if(!it||!it.nombre) return; const k=_cqKey(it); if(yaKeys.has(k)) return; yaKeys.add(k);
      arr.push({ id:"cq_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7), com:comRef, nombre:it.nombre, tipo:it.tipo||0, loc:it.loc||"", prov:it.prov||"", dom:it.dom||"", por:por||"", ts:new Date().toISOString(), partnerId:null }); n++; });
    if(n) await conquistarGuardar(arr); return n;
  }
  function conquistarDeComercial(arr, comRef){ return (arr||[]).filter(x=>x && x.com===comRef); }
  async function conquistarSetPartner(id, partnerId){ const arr=await conquistarLeer(); const it=arr.find(x=>x&&x.id===id); if(it){ it.partnerId=partnerId; await conquistarGuardar(arr); } return arr; }
  async function conquistarQuitar(id){ const arr=(await conquistarLeer()).filter(x=>x&&x.id!==id); await conquistarGuardar(arr); return arr; }
  /* Aplica campos a un item (ej. {descartado:{motivo,por,ts}} o {archivado:true}). RMW. */
  async function conquistarPatch(id, patch){ const arr=await conquistarLeer(); const it=arr.find(x=>x&&x.id===id); if(it){ Object.assign(it, patch||{}); await conquistarGuardar(arr); } return arr; }

  /* ===== LEGAJOS DE CLIENTES (documentación de alta) =====
     Administración (Vanesa/Bárbara) carga la documentación de alta de cada cliente. Los
     archivos van como ADJUNTO del contacto en Odoo (ir.attachment sobre res.partner), así
     quedan pegados al cliente y visibles también desde Odoo. La metadata (tipo de documento,
     vencimiento, quién/cuándo lo cargó) viaja en el campo `description` del adjunto como un
     marcador JSON `[LEGAJO]{...}` — parseable acá y legible en Odoo. El módulo es
     finanzas/legajos.html; este motor se comparte para mostrar el semáforo del legajo en
     otros módulos (CRM, Cobranzas), igual que la alerta de crédito. */
  const LEGAJO_TAG="[LEGAJO]";
  /* Checklist de documentación de alta. `vence:true` = el documento se renueva (lleva fecha
     de vencimiento). Para sumar/quitar documentos, editar SOLO esta lista. */
  const LEGAJO_DOCS=[
    {k:"habilitacion", lbl:"Habilitación sanitaria", vence:true},
    {k:"cuit",         lbl:"Constancia de CUIT",     vence:false},
  ];
  function legajoParse(desc){
    if(!desc) return null; const i=desc.indexOf(LEGAJO_TAG); if(i<0) return null;
    try{ const j=JSON.parse(desc.slice(i+LEGAJO_TAG.length).trim()); return (j&&j.t)?j:null; }catch(e){ return null; }
  }
  function legajoMarker(meta){ return LEGAJO_TAG+JSON.stringify(meta||{}); }
  const _legDiasHasta=ymd=>{ if(!ymd) return null; const h=new Date(argToday()+"T00:00:00"); const v=new Date(String(ymd).slice(0,10)+"T00:00:00"); return Math.round((v-h)/86400000); };
  /* estado de un legajo ya armado {docs:{tipo:{...}}} → agrega estado/falta/vencidos/porVencer.
     estado: verde (completo y vigente) · amarillo (algo por vencer o sin fecha) · rojo (falta
     un obligatorio o algo vencido) · vacio (nada cargado). */
  function evaluarLegajo(e, alerta){
    alerta=alerta||30; e.falta=[]; e.vencidos=[]; e.porVencer=[];
    LEGAJO_DOCS.forEach(d=>{
      const doc=e.docs[d.k];
      if(!doc){ e.falta.push(d); return; }
      if(d.vence){ const n=_legDiasHasta(doc.vence);
        if(n===null) e.porVencer.push({doc:d,dias:null});          // cargado pero sin fecha de vencimiento
        else if(n<0) e.vencidos.push({doc:d,dias:n});
        else if(n<=alerta) e.porVencer.push({doc:d,dias:n});
      }
    });
    if(!Object.keys(e.docs).length) e.estado="vacio";
    else if(e.falta.length || e.vencidos.length) e.estado="rojo";
    else if(e.porVencer.length) e.estado="amarillo";
    else e.estado="verde";
    return e;
  }
  /* Estado del legajo de una lista de partners (o de todos los que tengan algo cargado si no
     se pasan ids). UNA sola query a ir.attachment. Devuelve {byId:{partnerId:{docs,estado,...}}}. */
  async function legajoEstado(ids, opts){
    opts=opts||{}; const alerta=opts.dias||30;
    const dom=[["res_model","=","res.partner"],["description","=like",LEGAJO_TAG+"%"]];
    if(ids&&ids.length) dom.push(["res_id","in",ids]);
    let rows=[];
    try{ rows=await rpc("ir.attachment","search_read",[dom],{fields:["id","res_id","name","description","mimetype","create_date"],limit:0}); }catch(e){ rows=[]; }
    const byId={};
    for(const r of rows){ const m=legajoParse(r.description); if(!m||!r.res_id) continue;
      const pid=Array.isArray(r.res_id)?r.res_id[0]:r.res_id;
      const e=byId[pid]||(byId[pid]={docs:{},estado:"vacio",falta:[],vencidos:[],porVencer:[]});
      const prev=e.docs[m.t];
      if(!prev || (r.create_date||"")>(prev.create_date||"")) e.docs[m.t]={attId:r.id,tipo:m.t,vence:m.v||null,fisico:!!m.f,por:m.p||"",email:m.u||"",ts:m.ts||r.create_date,name:r.name,mimetype:r.mimetype,create_date:r.create_date};
    }
    Object.keys(byId).forEach(pid=>evaluarLegajo(byId[pid],alerta));
    return {byId, dias:alerta};
  }
  function legajoStyles(){ if(typeof document==="undefined"||document.getElementById("eyg-leg-css")) return; const s=document.createElement("style"); s.id="eyg-leg-css"; s.textContent=".eyg-leg{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:20px;white-space:nowrap}.eyg-leg .pt{width:7px;height:7px;border-radius:50%;background:currentColor}.eyg-leg.g{background:#E4F5E9;color:#1E7D46}.eyg-leg.y{background:#FBF0DA;color:#9A6B12}.eyg-leg.r{background:#FBE4E3;color:#B0322F}.eyg-leg.n{background:#eef1f1;color:#8A9A97}"; document.head.appendChild(s); }
  const LEGAJO_ESTADO_META={verde:{c:"g",t:"Legajo al día"},amarillo:{c:"y",t:"Por vencer / incompleto"},rojo:{c:"r",t:"Falta / vencido"},vacio:{c:"n",t:"Sin legajo"}};
  function badgeLegajo(estado){ legajoStyles(); const m=LEGAJO_ESTADO_META[estado]||LEGAJO_ESTADO_META.vacio; return `<span class="eyg-leg ${m.c}" title="${esc(m.t)}"><span class="pt"></span>${esc(m.t)}</span>`; }

  /* ===== CONFIG DE COMISIONES (una sola fuente, editable por Dirección) =====
     Vive en ir.config_parameter `eyg.comisiones` (JSON). La usan el panel del comercial
     y el del líder para calcular la META de facturación (y las tasas), así los dos coinciden.
       metaMeses        = cuántos meses cerrados se promedian (default 3).
       metaMetodo       = "promedio" | "mediana" (mediana no la distorsiona una licitación puntual).
       metaCrecimiento  = cuánto se le suma por encima del promedio (0.20 = +20%).
       metaCuentaVacios = si un mes flojo/sin facturar cuenta como $0 (true) o se saltea (false).
       rates            = tasas de la escalera por perfil (base = hasta la meta, high = por encima).
       perfilTicket     = ticket promedio que separa Instituciones de Farmacias.
       externoCorte     = corte fijo del externo (Samanta), en $. */
  const COMI_KEY="eyg.comisiones";
  const COMI_DEF={ metaMeses:3, metaMetodo:"promedio", metaCrecimiento:0.20, metaCuentaVacios:true,
    rates:{ inst:{base:.020,high:.030}, farm:{base:.025,high:.035}, externo:{base:.030,high:.040} },
    perfilTicket:300000, externoCorte:50000000 };
  let _comiCfg=null;
  async function comisionesConfig(force){ if(_comiCfg && !force) return _comiCfg; let o={}; try{ o=JSON.parse(await rpc("ir.config_parameter","get_param",[COMI_KEY])||"{}")||{}; }catch(e){}
    _comiCfg=Object.assign({}, COMI_DEF, o); _comiCfg.rates=Object.assign({}, COMI_DEF.rates, (o&&o.rates)||{}); return _comiCfg; }
  async function comisionesGuardar(cfg){ const c=Object.assign({}, COMI_DEF, cfg||{}); c.rates=Object.assign({}, COMI_DEF.rates, (cfg&&cfg.rates)||{}); _comiCfg=c; await rpc("ir.config_parameter","set_param",[COMI_KEY, JSON.stringify(c)]); return c; }
  /* Las N claves "YYYY-MM" de los meses ANTERIORES a curM (curM = mes en curso, se excluye). */
  function _mesesPrevios(curM, n){ let [y,m]=String(curM).split("-").map(Number); const out=[]; for(let i=0;i<n;i++){ m--; if(m<1){m=12;y--;} out.unshift(y+"-"+String(m).padStart(2,"0")); } return out; }
  /* META pura: recibe fbk={"YYYY-MM":neto} (facturado neto por mes), el mes en curso y la config.
     Devuelve el baseline (promedio o mediana de los meses de la ventana) y la meta = baseline×(1+crecimiento).
     `meses` lista los N meses de la ventana con su neto (null si el mes no tiene datos) para mostrarlos. */
  function metaDesde(fbk, curM, cfg){
    cfg=cfg||_comiCfg||COMI_DEF; fbk=fbk||{};
    const n=Math.max(1, cfg.metaMeses||3);
    const keys=_mesesPrevios(curM, n);
    const meses=keys.map(k=>({key:k, net:(k in fbk)?fbk[k]:null}));
    const cuenta = cfg.metaCuentaVacios!==false;
    const nums = cuenta ? meses.map(v=>v.net||0) : meses.filter(v=>v.net!=null).map(v=>v.net);
    let baseline=0;
    if(nums.length){
      if(cfg.metaMetodo==="mediana"){ const s=[...nums].sort((a,b)=>a-b), mid=Math.floor(s.length/2); baseline = s.length%2 ? s[mid] : (s[mid-1]+s[mid])/2; }
      else baseline = nums.reduce((a,b)=>a+b,0)/nums.length;
    }
    const meta = baseline*(1+(cfg.metaCrecimiento||0));
    return { baseline, meta, meses, nUsados:nums.length };
  }

  return { supa, rpc, gate, BASE, abs, money, esc, hace, argToday, argParts, argNowFrac, huella, esSuper, session, perfil, login, logout, requireAuth, guard, showLogin, showChangePwd, markPwdChanged, gateMsg, topbar, DEPTS, MODULOS, puedeVer, T, sidebar, layout, homeMain, rail, railActiveKey, cardOfertasSemana, ofStockMap, ofAgotada, debounce, repintar, buscador, BUSCA_MS, presenciaPing, startPresencia,
    COMI_KEY, COMI_DEF, comisionesConfig, comisionesGuardar, metaDesde,
    LEGAJO_DOCS, LEGAJO_TAG, LEGAJO_ESTADO_META, legajoParse, legajoMarker, evaluarLegajo, legajoEstado, legajoStyles, badgeLegajo,
    riesgoCartera, riesgoNivel, riesgoMotivo, badgeRiesgo, marcarRiesgo, sacarRiesgo, riesgoBCRA, RIESGO_TAG,
    bcraFull, bcraClasificar, bcraResumen, bcraCacheLeer, bcraCacheMerge, badgeBCRA, bcraStyles,
    creditoConfig, evalCredito, badgeCredito, credStyles, credLeyendaHTML, CRED_NIV,
    conquistarLeer, conquistarGuardar, conquistarAsignar, conquistarDeComercial, conquistarSetPartner, conquistarQuitar, conquistarPatch, notificarRoles,
    orgCargar, orgDescendientes, orgAncestros, notificarLideresDe,
    COM_KEY, COM_DEPTS, comDeptDeRol, comsLeer, comsGuardar, rosterCore, comsParaMi, comLeida, comMarcarLeido,
    wasParaComercial, comVistoWA, comMarcarVistoWA, waMarker,
    bellComunicaciones, comToggleBell, comMarcarYRepintar, comMarcarTodas, comVerWA,
    comArchivada, comSetArchivo, comAbrirNota, comAbrirGestor, comCerrarOverlay,
    comLeidoDesde, comArchivarDesde, comMarcarTodasGestor, _ovBg, _gsTab, _gsToggle };
})();
