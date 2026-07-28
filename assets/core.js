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

  /* ---- auth ---- */
  async function session(){ const {data} = await supa().auth.getSession(); return data.session; }
  async function perfil(){
    const s = await session(); if(!s) return null;
    const email = (s.user.email||"").toLowerCase();
    const {data} = await supa().from("core_users").select("email,nombre,rol,comercial_ref,activo,debe_cambiar_pwd").eq("email",email).maybeSingle();
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
  async function guard(roles){
    let s; try{ s = await session(); }catch(e){ showLogin(); return new Promise(()=>{}); }
    if(!s){ showLogin(); return new Promise(()=>{}); }
    const p = await perfil();
    if(!p || !p.activo){ gateMsg("🔒","Sin acceso","Tu cuenta todavía no tiene un perfil activo en el Core. Avisá al administrador.",false); return new Promise(()=>{}); }
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
    {key:"cobranzas", dept:"finanzas", cat:"Finanzas", ico:"💳", titulo:"Cobranzas", desc:"Deuda por cliente con antigüedad (+30/+60/+90/+120) para reclamar y detectar incobrables.", roles:["finanzas","lider","cobranzas"], ready:true, path:()=>"finanzas/cobranzas.html"},
    {key:"stock",     dept:"inventario", cat:"Inventario", ico:"📦", titulo:"Stock y Sobrestock", desc:"Plata inmovilizada, rotación por producto y vencimientos. Qué frenar y qué liquidar.", roles:["finanzas","inventario"], ready:false, path:()=>"inventario/stock.html"},
    {key:"nombres",   dept:"inventario", cat:"Inventario", ico:"🏷️", titulo:"Maestro de productos", desc:"Ordená el dato maestro de cada producto: nombre, unidades, embalaje y subcategoría. Detecta errores y completa lo que falta, con un clic.", roles:["inventario"], ready:true, path:()=>"inventario/nombres.html"},
    {key:"contactos", dept:"datos", cat:"Datos", ico:"🗂️", titulo:"Contactos", desc:"Calidad de datos (teléfono, email, condición fiscal), duplicados y ventas por comercial.", roles:["comercial","lider","admin"], ready:false, path:()=>"datos/contactos.html"},
    {key:"radiografia",dept:"direccion", cat:"Dirección", ico:"📊", titulo:"Radiografía", desc:"Ventas, facturación, márgenes, cobranza y stock de toda la droguería en un tablero.", roles:["direccion"], ready:false, path:()=>"direccion/radiografia.html"},
    {key:"usuarios",  dept:"admin", cat:"Sistema", ico:"👤", titulo:"Usuarios y accesos", desc:"Altas de personal, roles y qué módulo puede ver cada uno.", roles:["admin"], ready:false, path:()=>"admin/usuarios.html"},
  ];
  function puedeVer(m, rol){ return rol==="admin"||rol==="direccion" ? true : m.roles.includes(rol); }
  function T(v,p){ return typeof v==="function" ? v(p) : v; }  // título/desc pueden depender del rol

  function sidebar(perfil, activeKey){
    const vis = MODULOS.filter(m=>puedeVer(m,perfil.rol));
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
    const vis = MODULOS.filter(m=>puedeVer(m,perfil.rol));
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

  return { supa, rpc, BASE, abs, money, esc, hace, session, perfil, login, logout, requireAuth, guard, showLogin, showChangePwd, markPwdChanged, gateMsg, topbar, DEPTS, MODULOS, puedeVer, sidebar, layout, homeMain };
})();
