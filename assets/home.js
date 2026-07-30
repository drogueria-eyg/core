/* ===== EyG Core · Dashboard de inicio =====================================
   Reemplaza el viejo lanzador de tarjetas por un tablero en vivo contra Odoo.

   Cómo está armado (importa para no romperlo):
   · El ÁMBITO depende del rol. Un comercial ve SU cartera y SUS ventas; el
     resto de los roles ve la droguería consolidada. Ver `scope()` y las
     banderas `V.*` — nunca mostrar facturación/márgenes globales a un comercial.
   · Se pinta en OLAS (`ola1/ola2/ola3`): primero los KPIs de venta (una vuelta
     a Odoo), después cobranza/clientes, y al final stock/tops/novedades. Cada
     bloque se dibuja cuando llega, con esqueletos mientras espera. Si una ola
     falla, las otras siguen funcionando.
   · Todas las fechas se resuelven en hora de Argentina (UTC−3, sin horario de
     verano). Odoo guarda `date_order` en UTC: filtrar por "2026-07-01" a secas
     mete 3 horas del 30/6. Para eso están `uDesde()/uHasta()`.
   · Las series del gráfico se cachean por granularidad (`CACHE`) y se piden
     recién cuando el usuario toca la pestaña.
========================================================================== */
window.EYGHome = (function(){
  const rpc=EYG.rpc, M=EYG.money, esc=EYG.esc, abs=EYG.abs;
  const TZ="America/Argentina/Buenos_Aires";
  const CTX={context:{lang:"es_AR", tz:TZ}};   // que Odoo agrupe los meses/semanas en hora AR

  /* ---------- fechas (todo en el espacio de fechas AR, como "YYYY-MM-DD") ---------- */
  const dObj = s => new Date(s.slice(0,10)+"T00:00:00Z");
  const dStr = d => d.toISOString().slice(0,10);
  const addD = (s,n)=>{ const d=dObj(s); d.setUTCDate(d.getUTCDate()+n); return dStr(d); };
  const addM = (s,n)=>{ const d=dObj(s.slice(0,7)+"-01"); d.setUTCMonth(d.getUTCMonth()+n); return dStr(d); };
  const addA = (s,n)=> (Number(s.slice(0,4))+n)+s.slice(4);
  const dow  = s => (dObj(s).getUTCDay()+6)%7;              // 0 = lunes
  /* AR es UTC−3 todo el año: las 00:00 de acá son las 03:00 UTC. */
  const uDesde = s => s+" 03:00:00";
  const uHasta = s => addD(s,1)+" 02:59:59";

  const MES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const MES3=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const DIA3=["lun","mar","mié","jue","vie","sáb","dom"];
  const dm = s => s.slice(8,10)+"/"+s.slice(5,7);

  /* ---------- formato ---------- */
  function mc(n){                                    // plata compacta para números grandes
    n=n||0; const a=Math.abs(n);
    if(a>=1e6){ const v=n/1e6; return "$"+(a>=1e8?Math.round(v).toLocaleString("es-AR"):v.toFixed(1).replace(".",","))+"M"; }
    if(a>=1e4) return "$"+Math.round(n/1e3).toLocaleString("es-AR")+"k";
    return "$"+Math.round(n).toLocaleString("es-AR");
  }
  const ent = n => Math.round(n||0).toLocaleString("es-AR");
  const pct = n => (n>0?"+":"")+Math.round(n)+"%";
  function delta(hoy, base, txt){
    if(!base) return `<span class="delta flat">— ${esc(txt||"sin base")}</span>`;
    const v=(hoy-base)/base*100, cls=v>=1?"up":(v<=-1?"dn":"flat"), ic=v>=1?"▲":(v<=-1?"▼":"=");
    return `<span class="delta ${cls}">${ic} ${pct(v)}${txt?" "+esc(txt):""}</span>`;
  }

  /* Números que cuentan hacia arriba al aparecer. `data-to` + `data-fmt`.
     Ojo: requestAnimationFrame NO corre si la pestaña está en segundo plano.
     Si arrancáramos en 0 y confiáramos sólo en los frames, alguien que abre el
     Core en una pestaña de fondo se encontraría todo el tablero en $0 para
     siempre. Por eso: sin frames → valor final directo, y una red de seguridad
     por setTimeout (que sí corre en segundo plano) para cerrar la animación. */
  function paintNums(root){
    const quieto = window.matchMedia && matchMedia("(prefers-reduced-motion:reduce)").matches;
    (root||document).querySelectorAll("[data-to]").forEach(el=>{
      const to=Number(el.dataset.to)||0, f=el.dataset.fmt||"mc";
      const fmt = f==="money"?M : f==="ent"?ent : f==="pct"?(v=>Math.round(v)+"%") : mc;
      el.removeAttribute("data-to");
      if(!to || quieto || document.hidden){ el.textContent=fmt(to); return; }
      const t0=performance.now(), ms=760;
      let vivo=true;
      const red=setTimeout(()=>{ vivo=false; el.textContent=fmt(to); }, ms+400);
      (function step(t){
        if(!vivo) return;
        const k=Math.min(1,(t-t0)/ms);
        el.textContent=fmt(to*(1-Math.pow(1-k,3)));
        if(k<1) requestAnimationFrame(step);
        else { vivo=false; clearTimeout(red); el.textContent=fmt(to); }
      })(t0);
    });
  }
  const skel=(n=4)=>`<div class="skrows">${Array.from({length:n},()=>'<div><div class="skel t"></div><div class="skel s"></div></div>').join("")}</div>`;
  function put(id, html){ const el=document.getElementById(id); if(el){ el.innerHTML=html; paintNums(el); } }
  function fail(id, e, qué){ const el=document.getElementById(id); if(el) el.innerHTML=`<div class="errmini">No pude leer ${esc(qué)} de Odoo. ${esc((e&&e.message)||"")}</div>`; }

  /* ---------- estado ---------- */
  let P=null;            // perfil
  let V={};              // qué ve este rol
  let SC={tipo:"global", uid:null, cartera:null};
  let HOY, MES_INI, SEM_INI, ANO_INI;
  let ORD8=[], ORD8_OK=false;   // pedidos de los últimos 8 días (hoy / hora x hora / sparkline)
  /* Las olas 2 y 3 arrancan en paralelo con la 1, pero algunos números ("compraron
     hoy", "quién vendió hoy") salen de ORD8, que llena la ola 1. Sin esta espera
     mostraban 0 según quién ganara la carrera. */
  let _r1=null; const LISTO1=new Promise(r=>{ _r1=r; });
  let GRA="hora";        // granularidad activa del gráfico
  const CACHE={};        // series ya traídas
  let timers=[];

  /* ---------- granularidades del gráfico de evolución ---------- */
  const GRAN={
    hora:  {lab:"Hora",   uni:"hora",   n:0},
    dia:   {lab:"Día",    uni:"día",    n:30, g:"day",   prev:(s,k)=>addD(s,-k),   ini:s=>s},
    semana:{lab:"Semana", uni:"semana", n:16, g:"week",  prev:(s,k)=>addD(s,-7*k), ini:s=>addD(s,-dow(s))},
    mes:   {lab:"Mes",    uni:"mes",    n:18, g:"month", prev:(s,k)=>addM(s,-k),   ini:s=>s.slice(0,7)+"-01"},
    ano:   {lab:"Año",    uni:"año",    n:6,  g:"year",  prev:(s,k)=>addA(s,-k),   ini:s=>s.slice(0,4)+"-01-01"},
  };
  const bkt = (k,s)=>GRAN[k].ini(s.slice(0,10));
  function etiqueta(k,s){
    if(k==="dia")    return dm(s);
    if(k==="semana") return dm(s);
    if(k==="mes")    return MES3[+s.slice(5,7)-1]+"'"+s.slice(2,4);
    return s.slice(0,4);
  }
  function etiquetaLarga(k,s){
    if(k==="dia")    return DIA3[dow(s)]+" "+(+s.slice(8,10))+" de "+MES[+s.slice(5,7)-1];
    if(k==="semana") return "semana del "+dm(s)+" al "+dm(addD(s,6));
    if(k==="mes")    return MES[+s.slice(5,7)-1]+" de "+s.slice(0,4);
    return "año "+s.slice(0,4);
  }

  /* ---------- ámbito por rol ---------- */
  function scope(p){
    const rol=p.rol;
    const jefe = rol==="admin"||rol==="direccion";
    const V={
      ventas:   rol!=="maestro",
      propio:   rol==="comercial",
      cobranza: jefe||["finanzas","cobranzas","lider"].includes(rol),
      stock:    jefe||["finanzas","inventario"].includes(rol),
      margen:   jefe||["finanzas","lider"].includes(rol),
      equipo:   jefe||rol==="lider",
      clientes: rol!=="maestro",
      comision: rol==="comercial",
      novedades:true,
    };
    /* Un comercial ve su cartera; nadie más necesita el filtro por usuario. */
    if(rol==="comercial"){ V.margen=true; V.cobranza=true; }
    return V;
  }

  /* Resuelve el user_id de Odoo del comercial (perfil.comercial_ref = su nombre). */
  async function resolverComercial(){
    if(!V.propio) return;
    if(!P.comercial_ref){ SC.aviso="Tu usuario todavía no está vinculado a un vendedor de Odoo. Pedile al administrador que complete tu ficha para ver tus números."; return; }
    try{
      const u=await rpc("res.users","search_read",[[["name","=",P.comercial_ref]]],{fields:["id"],limit:1});
      if(!u.length){ SC.aviso="No encontré el vendedor \""+P.comercial_ref+"\" en Odoo."; return; }
      SC.tipo="propio"; SC.uid=u[0].id;
      SC.cartera = await rpc("res.partner","search",[[["user_id","=",SC.uid]]]);
    }catch(e){ SC.aviso="No pude identificar tu cartera en Odoo ("+e.message+")."; }
  }

  /* Dominios según ámbito */
  const domVentas = extra => [["state","in",["sale","done"]]]
      .concat(SC.uid?[["user_id","=",SC.uid]]:[])
      .concat(extra||[]);
  const domLineas = extra => [["order_id.state","in",["sale","done"]]]
      .concat(SC.uid?[["order_id.user_id","=",SC.uid]]:[])
      .concat(extra||[]);
  const domSocios = extra => (SC.cartera?[["id","in",SC.cartera]]:[]).concat(extra||[]);
  const domCuenta = extra => (SC.cartera?[["partner_id","in",SC.cartera]]:[]).concat(extra||[]);

  /* Facturación del año AGRUPADA POR DÍA, en dos consultas (facturas y notas de
     crédito). Con eso armo hoy/semana/mes/año del lado del cliente: pedir cada
     período por separado serían 10 llamadas por refresco en vez de 2.
     Devuelve {ok:false} si el rol no puede leer contabilidad, para ocultar el
     dato en vez de mostrar un $0 que se leería como "no facturamos nada".
     Ojo: `invoice_date` es fecha (no fecha-hora), así que no lleva ajuste de
     huso; los pedidos sí, porque `date_order` es fecha-hora en UTC. */
  async function facturacion(){
    const porDia = async tipo => {
      const g=await rpc("account.move","read_group",
        [domCuenta([["move_type","=",tipo],["state","=","posted"],["invoice_date",">=",ANO_INI]]),
         ["amount_untaxed:sum"],["invoice_date:day"]],
        Object.assign({lazy:false},CTX));
      return g.map(r=>{
        const rg=r.__range&&r.__range["invoice_date:day"];
        return {d:String(rg?rg.from:(r["invoice_date:day"]||"")).slice(0,10), m:r.amount_untaxed||0, n:r.__count||0};
      }).filter(x=>x.d);
    };
    try{
      const [inv, ref] = await Promise.all([porDia("out_invoice"), porDia("out_refund")]);
      const acum=(filas,desde,hasta)=>filas.reduce((a,f)=>
        (f.d>=desde && (!hasta||f.d<=hasta)) ? {m:a.m+f.m, n:a.n+f.n} : a, {m:0,n:0});
      const neto=(desde,hasta)=>acum(inv,desde,hasta).m - acum(ref,desde,hasta).m;
      const facMes=acum(inv,MES_INI);
      return {ok:true,
        hoy:neto(HOY,HOY), sem:neto(SEM_INI), mes:neto(MES_INI), ano:neto(ANO_INI),
        ticketMes: facMes.n?facMes.m/facMes.n:0, nFacMes:facMes.n};
    }catch(e){ return {ok:false}; }
  }

  async function sumaVentas(desde, hasta){
    const d=domVentas([["date_order",">=",uDesde(desde)]]);
    if(hasta) d.push(["date_order","<=",uHasta(hasta)]);
    const g=await rpc("sale.order","read_group",[d,["amount_untaxed:sum"],[]],Object.assign({lazy:false},CTX));
    return {m:(g[0]&&g[0].amount_untaxed)||0, n:(g[0]&&g[0].__count)||0};
  }

  /* ======================= ESQUELETO ======================= */
  function main(perfil){
    P=perfil; V=scope(perfil); HOY=EYG.argToday();
    MES_INI=HOY.slice(0,7)+"-01"; ANO_INI=HOY.slice(0,4)+"-01-01"; SEM_INI=addD(HOY,-dow(HOY));
    const nombre=(P.nombre||P.email||"").split(" ")[0];
    const h=EYG.argNowFrac();
    const saludo = h<6?"Buenas noches" : h<13?"Buen día" : h<20?"Buenas tardes" : "Buenas noches";
    const fecha = DIA3[dow(HOY)].replace(/^./,c=>c.toUpperCase())+" "+(+HOY.slice(8,10))+" de "+MES[+HOY.slice(5,7)-1];

    let d=0; const tarjeta=(id,tit)=>`<div class="cx rise" id="${id}" style="animation-delay:${(d+=.04).toFixed(2)}s">${cxSkel(tit)}</div>`;
    /* Sólo emito los contenedores que van a tener algo: una .cols vacía deja un
       hueco raro, y —más importante— cualquier tarjeta que exista se llena con
       plata. El rol `maestro` no debe ver ni pedidos ni facturación. */
    const fila = (cls, hijos) => { const h=hijos.filter(Boolean); return h.length?`<div class="${cls}">${h.join("")}</div>`:""; };

    return `
    <div class="dhead rise">
      <div>
        <h1>${saludo}, ${esc(nombre)} 👋</h1>
        <div class="sub">${fecha} · ${V.ventas?(V.propio?"tus números":"la droguería")+" en vivo desde Odoo":"tus herramientas de Droguería EyG"}</div>
      </div>
      <div class="meta">
        <span class="chip-live" id="dh-live"><span class="dot"></span><span class="clock" id="dh-clock">--:--</span></span>
        ${V.ventas?`<span class="chip-live" id="dh-sync" style="cursor:pointer" onclick="EYGHome.refrescar()" title="Volver a leer Odoo">↻ <span id="dh-syncT">actualizando…</span></span>`:""}
      </div>
    </div>
    <div id="dz-aviso"></div>
    ${V.ventas?`<div id="dz-kpi" class="rise" style="animation-delay:.04s">${kpiSkel()}</div>`:""}
    ${V.ventas?`<div id="dz-evo" class="cx evo rise" style="animation-delay:.08s">${evoSkel()}</div>`:""}
    ${fila("cols3",[
      V.cobranza?tarjeta("dz-cob","💳 Cobranza"):"",
      V.stock   ?tarjeta("dz-stk","📦 Stock"):"",
      V.clientes?tarjeta("dz-cli","👥 Clientes"):"" ])}
    ${fila("cols",[
      tarjeta("dz-nov","📣 Novedades"),
      V.ventas?tarjeta("dz-act","⚡ Últimos pedidos"):"" ])}
    ${fila("cols",[
      V.ventas?tarjeta("dz-prod","🏆 Productos del mes"):"",
      V.ventas?tarjeta("dz-top",V.equipo?"🎯 Equipo comercial":"🏬 Clientes del mes"):"" ])}
    <div class="cx rise" style="animation-delay:.4s">
      <div class="cx-h"><h2>🚀 Accesos rápidos</h2><span class="hint">todos tus módulos también están en el menú de la izquierda</span></div>
      ${quickHTML()}
    </div>
    <div class="dfoot"><span>EyG Core · panel interno de Droguería EyG</span><span>Datos en vivo de Odoo · uso exclusivo del personal</span></div>`;
  }
  const kpiSkel = ()=>`<div class="kgrid">${Array.from({length:5},(_,i)=>`<div class="ktile${i?"":" big"}"><div class="skel s" style="width:55%"></div><div class="skel t" style="margin-top:9px"></div></div>`).join("")}</div>`;
  const evoSkel = ()=>`<div class="cx-h"><h2>📈 Evolución de ventas</h2></div><div class="skel" style="height:230px;border-radius:12px;margin-top:10px"></div>`;
  const cxSkel = t=>`<div class="cx-h"><h2>${t}</h2></div>${skel(3)}`;

  function quickHTML(){
    const vis=EYG.MODULOS.filter(m=>EYG.puedeVer(m,P));
    if(!vis.length) return `<div class="nodata">Todavía no tenés módulos habilitados. Avisale al administrador.</div>`;
    return `<div class="qgrid">${vis.map(m=>{
      const dis=!m.ready, href=dis?"#":abs(m.path(P));
      const inner=`<span class="qi">${m.ico}</span><span class="qt">${esc(EYG.T(m.titulo,P))}<span>${dis?"pronto":esc(EYG.T(m.cat,P))}</span></span>`;
      return dis?`<div class="q dis">${inner}</div>`:`<a class="q" href="${href}">${inner}</a>`;
    }).join("")}</div>`;
  }

  /* ======================= ARRANQUE ======================= */
  async function init(perfil){
    const mb=document.querySelector(".mbody"); if(mb) mb.classList.add("wide");
    reloj();
    /* main() ya se armó cuando esto resuelve, así que el aviso va a su hueco. */
    await resolverComercial();
    if(SC.aviso) put("dz-aviso", `<div class="errmini" style="margin-bottom:18px">⚠️ ${esc(SC.aviso)}</div>`);
    /* Si el ámbito es "lo tuyo" pero no pudimos identificar al vendedor, los
       dominios quedarían SIN filtro por usuario: el comercial vería la venta de
       toda la droguería rotulada como propia. Antes de eso, no mostramos nada. */
    if(V.propio && !SC.uid){ sinAmbito(); return; }
    if(V.ventas){
      ola1();
      timers.push(setInterval(()=>{ ola1({silencioso:true}); }, 60000));
    }else if(_r1){ _r1(); _r1=null; }   // sin ola 1 nadie debe quedar esperándola
    ola2(); ola3();
    /* El lienzo del gráfico se elige según el ancho: si rotan el celular o
       cambian la ventana hay que rearmarlo o queda con la escala vieja. */
    let reDib; window.addEventListener("resize", ()=>{ clearTimeout(reDib); reDib=setTimeout(pintarEvo,220); });
    window.addEventListener("beforeunload", ()=>timers.forEach(clearInterval));
  }
  /* Ámbito personal irresoluble: dejamos las novedades y los accesos (no dependen
     del usuario) y explicamos por qué no hay números, en vez de mostrar los de todos. */
  function sinAmbito(){
    ["dz-kpi","dz-evo","dz-cob","dz-stk","dz-cli","dz-prod","dz-top"].forEach(id=>{
      const el=document.getElementById(id); if(!el) return;
      el.innerHTML=`<div class="nodata" style="padding:26px 14px;line-height:1.6">Tus métricas van a aparecer acá en cuanto tu usuario quede vinculado a tu vendedor de Odoo.<br><span style="font-size:11.5px">Mientras tanto no mostramos números para no confundir los tuyos con los de toda la droguería.</span></div>`;
      el.classList.add("cx");
    });
    sincronizado(true);
    cargarNovedades().catch(()=>{});
  }
  function reloj(){
    const f=()=>{ const e=document.getElementById("dh-clock");
      if(e) e.textContent=new Intl.DateTimeFormat("es-AR",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date())+" hs"; };
    f(); timers.push(setInterval(f,20000));
  }
  function sincronizado(ok){
    const c=document.getElementById("dh-sync"), t=document.getElementById("dh-syncT");
    if(!t) return;
    if(ok){ c.classList.remove("off"); t.textContent="al instante"; setTimeout(()=>{ if(t) t.textContent="hace un momento"; },8000); }
    else  { c.classList.add("off"); t.textContent="sin conexión"; }
  }
  function refrescar(){ CACHE.hora=null; ola1(); ola2(); ola3(); }

  /* ======================= OLA 1 · ventas ======================= */
  async function ola1(opt){
    try{
      const mAntIni=addM(MES_INI,-1);
      let mAntFin=addD(mAntIni, +HOY.slice(8,10)-1);
      if(mAntFin>=MES_INI) mAntFin=addD(MES_INI,-1);         // meses cortos (31 de marzo → 28 de febrero)
      const semAntIni=addD(SEM_INI,-7), semAntFin=addD(SEM_INI,-7+dow(HOY));

      const [ord, sem, semAnt, mes, mesAnt, ano, FAC] = await Promise.all([
        rpc("sale.order","search_read",[domVentas([["date_order",">=",uDesde(addD(HOY,-7))]]),
            ["name","partner_id","date_order","amount_untaxed","user_id"]],Object.assign({limit:0,order:"date_order desc"},CTX)),
        sumaVentas(SEM_INI), sumaVentas(semAntIni,semAntFin),
        sumaVentas(MES_INI),  sumaVentas(mAntIni,mAntFin),
        sumaVentas(ANO_INI),
        /* Facturado, para contrastar contra los pedidos en cada tarjeta.
           Pedidos y facturas NUNCA van a coincidir: el pedido se confirma un día
           y se factura otro. Si esto falla no debe tumbar los KPIs de venta. */
        facturacion(),
      ]);
      ORD8 = ord.map(o=>Object.assign({
        id:o.id, name:o.name, cli:o.partner_id?o.partner_id[1]:"—",
        vend:o.user_id?o.user_id[1]:"", amt:o.amount_untaxed||0
      }, EYG.argParts(o.date_order)));
      ORD8_OK=true;

      /* por día (8 días) y por hora (hoy / ayer) */
      const porDia={}; for(let i=7;i>=0;i--) porDia[addD(HOY,-i)]=0;
      const hHoy=new Array(24).fill(0), hAyer=new Array(24).fill(0);
      const AYER=addD(HOY,-1); let nHoy=0, cliHoy=new Set();
      for(const o of ORD8){
        if(o.date in porDia) porDia[o.date]+=o.amt;
        if(o.date===HOY){ hHoy[o.hour]+=o.amt; nHoy++; cliHoy.add(o.cli); }
        if(o.date===AYER) hAyer[o.hour]+=o.amt;
      }
      const nf=EYG.argNowFrac();
      const totHoy=hHoy.reduce((a,b)=>a+b,0);
      const ayerAhora=hAyer.reduce((a,v,h)=>a+(h<=nf?v:0),0);
      const ayerTot=hAyer.reduce((a,b)=>a+b,0);
      CACHE.hora={hHoy,hAyer,totHoy,ayerAhora,ayerTot,nHoy,nf};

      const dias=Object.keys(porDia), maxD=Math.max(...dias.map(d=>porDia[d]),1);
      const spark=dias.map(d=>`<i class="${d===HOY?"now":""}" style="height:${Math.max(4,Math.round(porDia[d]/maxD*100))}%;animation-delay:${dias.indexOf(d)*45}ms" title="${DIA3[dow(d)]} ${dm(d)}: ${M(porDia[d])}"></i>`).join("");

      /* Segunda línea de cada tile: la misma métrica leída desde la facturación.
         Se oculta entera si no pudimos leer contabilidad (ver facturacion()). */
      const AYUDA = "Arriba: pedidos confirmados, importe sin IVA, por fecha de pedido.&#10;Abajo: facturado neto = facturas emitidas menos notas de crédito, sin IVA, por fecha de factura.&#10;Nunca coinciden: el pedido se confirma un día y se factura otro.";
      const contra = (etq,val) => FAC.ok ? `<div class="ksplit"><span>${etq}</span><b title="${M(val)}">${mc(val)}</b></div>` : "";
      const tt = FAC.ok ? ` title="${AYUDA}"` : "";

      put("dz-kpi",`<div class="kgrid">
        <div class="ktile big"${tt}>
          <div class="kl">⚡ ${V.propio?"Tus pedidos":"Pedidos"} de hoy</div>
          <div class="kv" data-to="${totHoy}" data-fmt="mc" title="${M(totHoy)}">$0</div>
          <div class="ks">${ent(nHoy)} pedido${nHoy===1?"":"s"} · ${ent(cliHoy.size)} cliente${cliHoy.size===1?"":"s"} · ${delta(totHoy,ayerAhora,"vs ayer a esta hora")}</div>
          <div class="kspark">${spark}</div>
          ${contra("Facturado neto hoy", FAC.hoy)}
        </div>
        <div class="ktile"${tt}>
          <div class="kl">Esta semana · pedidos</div>
          <div class="kv" data-to="${sem.m}" title="${M(sem.m)}">$0</div>
          <div class="ks">${delta(sem.m,semAnt.m,"vs semana pasada")}</div>
          ${contra("Facturado neto", FAC.sem)}
        </div>
        <div class="ktile"${tt}>
          <div class="kl">Este mes · pedidos</div>
          <div class="kv" data-to="${mes.m}" title="${M(mes.m)}">$0</div>
          <div class="ks">${delta(mes.m,mesAnt.m,"vs mes pasado")}</div>
          ${contra("Facturado neto", FAC.mes)}
        </div>
        <div class="ktile" title="Arriba: importe promedio de un pedido confirmado del mes (sin IVA).&#10;Abajo: importe promedio de una factura emitida este mes (sin IVA).&#10;Suele haber más facturas que pedidos: un pedido puede facturarse en partes, y hay facturas que no nacen de un pedido.">
          <div class="kl">Ticket promedio · mes</div>
          <div class="kv" data-to="${mes.n?mes.m/mes.n:0}" title="${M(mes.n?mes.m/mes.n:0)}">$0</div>
          <div class="ks">${ent(mes.n)} pedidos · ayer cerró en ${mc(ayerTot)}</div>
          ${FAC.ok?`<div class="ksplit"><span>Ticket facturado<i>${ent(FAC.nFacMes)} facturas</i></span><b title="${M(FAC.ticketMes)}">${mc(FAC.ticketMes)}</b></div>`:""}
        </div>
        <div class="ktile"${tt}>
          <div class="kl">Este año · pedidos</div>
          <div class="kv" data-to="${ano.m}" title="${M(ano.m)}">$0</div>
          <div class="ks">${ent(ano.n)} pedidos desde enero</div>
          ${contra("Facturado neto", FAC.ano)}
        </div>
      </div>`);

      if(GRA==="hora") pintarEvo(); else pintarEvo(true);
      sincronizado(true);
      pintarActividad();
    }catch(e){
      sincronizado(false);
      if(!(opt&&opt.silencioso)) fail("dz-kpi", e, "las ventas");
    }finally{
      if(_r1){ _r1(); _r1=null; }   // liberar siempre: si falla, las otras olas no deben colgarse
    }
  }

  /* ======================= gráfico de evolución ======================= */
  async function serie(k){
    if(CACHE[k]) return CACHE[k];
    const g=GRAN[k], N=g.n, fin=bkt(k,HOY), ini=g.prev(fin, 2*N-1);
    const raw=await rpc("sale.order","read_group",
      [domVentas([["date_order",">=",uDesde(ini)]]),["amount_untaxed:sum"],["date_order:"+g.g]],
      Object.assign({lazy:false},CTX));
    /* Normalizo la clave que devuelve Odoo con mi propio inicio de bucket:
       así da igual si Odoo arranca la semana en domingo o en lunes. */
    const map={};
    for(const r of raw){
      const rg=r.__range&&r.__range["date_order:"+g.g];
      const from=rg?rg.from:r["date_order:"+g.g];
      if(!from) continue;
      const key=bkt(k,String(from));
      const o=map[key]||(map[key]={v:0,n:0});
      o.v+=r.amount_untaxed||0; o.n+=r.__count||0;
    }
    const pts=[];
    for(let i=2*N-1;i>=0;i--){ const key=g.prev(fin,i); const o=map[key]||{v:0,n:0}; pts.push({key,v:o.v,n:o.n}); }
    return (CACHE[k]={pts, N});
  }

  function serieHora(){
    const c=CACHE.hora; if(!c) return null;
    let lo=7, hi=21;
    c.hHoy.forEach((v,h)=>{ if(v>0){ lo=Math.min(lo,h); hi=Math.max(hi,h); } });
    hi=Math.max(hi,Math.ceil(c.nf));
    const pts=[]; for(let h=lo;h<=hi;h++) pts.push({key:String(h), v:c.hHoy[h], prev:c.hAyer[h], n:0});
    return {pts, N:pts.length, hora:true, tot:c.totHoy, prevTot:c.ayerAhora};
  }

  async function ver(k){
    GRA=k;
    document.querySelectorAll("#evo-pills button").forEach(b=>b.classList.toggle("on", b.dataset.k===k));
    if(k!=="hora" && !CACHE[k]){
      const w=document.getElementById("evo-body");
      if(w) w.innerHTML=`<div class="skel" style="height:230px;border-radius:12px"></div>`;
      try{ await serie(k); }catch(e){ if(w) w.innerHTML=`<div class="errmini">No pude traer la serie: ${esc(e.message)}</div>`; return; }
    }
    pintarEvo();
  }

  function pintarEvo(soloSiHora){
    const z=document.getElementById("dz-evo"); if(!z) return;
    if(soloSiHora && GRA!=="hora") return;
    const pills=`<div class="pills" id="evo-pills">${Object.keys(GRAN).map(k=>
      `<button data-k="${k}" class="${k===GRA?"on":""}" onclick="EYGHome.ver('${k}')">${GRAN[k].lab}</button>`).join("")}</div>`;
    if(!z.dataset.armado){
      z.innerHTML=`<div class="cx-h"><div><h2>📈 Evolución de ventas</h2><div class="hint">pedidos confirmados, sin IVA · por fecha de pedido</div></div>${pills}</div><div id="evo-body"></div>`;
      z.dataset.armado="1";
    }else{
      const p=document.getElementById("evo-pills"); if(p) p.outerHTML=pills;
    }
    const body=document.getElementById("evo-body"); if(!body) return;

    const s = GRA==="hora" ? serieHora() : CACHE[GRA];
    if(!s){ body.innerHTML=`<div class="skel" style="height:230px;border-radius:12px"></div>`; return; }

    let vis, comp, tot, compTot, cmpTxt="vs período anterior";
    if(s.hora){ vis=s.pts; comp=null; tot=s.tot; compTot=s.prevTot; cmpTxt="vs ayer a esta hora"; }
    else{
      vis=s.pts.slice(s.N); comp=s.pts.slice(0,s.N);
      tot=vis.reduce((a,p)=>a+p.v,0); compTot=comp.reduce((a,p)=>a+p.v,0);
      /* Si el período anterior está mayormente vacío no es que las ventas se
         multiplicaran: es que Odoo todavía no tenía datos tan atrás. Mostrar
         un "+254%" ahí sería mentir. */
      if(comp.filter(p=>p.v>0).length < Math.ceil(s.N*0.6)){ compTot=0; cmpTxt="sin historial comparable"; }
    }

    if(!tot && !compTot){ body.innerHTML=`<div class="evo-empty">Todavía no hay ventas registradas en este período.</div>`; return; }

    const conDato=vis.filter(p=>p.v>0);
    const prom = conDato.length?tot/conDato.length:0;
    const pico = vis.reduce((a,p)=>p.v>a.v?p:a, vis[0]);
    const uni  = GRAN[GRA].uni;
    const nPed = vis.reduce((a,p)=>a+(p.n||0),0);

    body.innerHTML=`
      <div class="evo-stats">
        <div class="es"><div class="l">${s.hora?"Acumulado de hoy":"Total del período"}</div><div class="v" data-to="${tot}" title="${M(tot)}">$0</div></div>
        <div class="es sm"><div class="l">Promedio por ${esc(uni)}</div><div class="v" data-to="${prom}" title="${M(prom)}">$0</div></div>
        <div class="es sm"><div class="l">Mejor ${esc(uni)}</div><div class="v" title="${M(pico.v)}">${mc(pico.v)}<span style="font-size:11px;color:var(--gris2);font-weight:700"> · ${esc(s.hora?pico.key+" hs":etiqueta(GRA,pico.key))}</span></div></div>
        <div class="es sm"><div class="l">${esc(cmpTxt)}</div><div class="v">${compTot?delta(tot,compTot,""):'<span class="delta flat">—</span>'}</div></div>
        ${nPed?`<div class="es sm"><div class="l">Pedidos</div><div class="v">${ent(nPed)}</div></div>`:""}
        ${s.hora?`<div class="es sm"><div class="l">&nbsp;</div><div class="v" style="font-size:12px"><span class="chip-live" style="padding:5px 10px"><span class="dot"></span>en vivo</span></div></div>`:""}
      </div>
      <div class="chartwrap" id="evo-chart">${svgBarras(vis, prom, s.hora)}<div class="tt" id="evo-tt"></div></div>`;
    paintNums(body);
    engancharTooltip(vis, s.hora);
  }

  function svgBarras(pts, prom, esHora){
    /* El SVG escala uniforme, así que el viewBox define el tamaño REAL del texto:
       con 1000 de ancho metido en un celular de 340px, las etiquetas quedan en 3px.
       Por eso en pantalla chica se usa un lienzo más angosto y alto. */
    const cont=document.getElementById("evo-body");
    const ancho=(cont&&cont.clientWidth)||900, chico=ancho<560;
    const W=chico?430:1000, H=chico?300:248, PL=chico?46:48, PR=8, PT=16, PB=chico?28:30;
    const fs=chico?13:11, fsc=chico?12:11;
    const x0=PL, x1=W-PR, y0=PT, y1=H-PB;
    const max=Math.max(...pts.map(p=>Math.max(p.v,p.prev||0)),1);
    const esc10=Math.pow(10,Math.floor(Math.log10(max)));
    const top=Math.ceil(max/esc10*2)/2*esc10 || max;
    const Y=v=>y1-(v/top)*(y1-y0);
    const slot=(x1-x0)/pts.length, bw=Math.min(slot*0.62,54), off=(slot-bw)/2;

    let grid="";
    for(let i=0;i<=2;i++){ const v=top*i/2, y=Y(v);
      grid+=`<line x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" stroke="#EBF2F1" stroke-width="1"/>`
          + `<text x="${x0-8}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="${fsc}" font-weight="700" fill="#9AACA8">${i?mc(v):"0"}</text>`;
    }
    /* referencia del promedio */
    const yP=Y(prom);
    const promL = prom>0 && yP>y0+6 ? `<line x1="${x0}" y1="${yP.toFixed(1)}" x2="${x1}" y2="${yP.toFixed(1)}" stroke="#EC8B5E" stroke-width="1.4" stroke-dasharray="6 5" opacity=".85"/>`
      +`<text x="${x1}" y="${(yP-6).toFixed(1)}" text-anchor="end" font-size="${fsc}" font-weight="800" fill="#C9743F">promedio ${mc(prom)}</text>` : "";

    const cur = esHora ? Math.floor(EYG.argNowFrac()) : null;
    let bars="", hits="", labs="";
    pts.forEach((p,i)=>{
      const x=x0+slot*i+off, y=Y(p.v), h=Math.max(y1-y,p.v>0?2:0);
      const activa = esHora && String(cur)===p.key;
      /* comparativo (ayer / período anterior) como sombra detrás */
      if(esHora && p.prev>0){
        const yp=Y(p.prev);
        bars+=`<rect x="${(x-2).toFixed(1)}" y="${yp.toFixed(1)}" width="${(bw+4).toFixed(1)}" height="${Math.max(y1-yp,2).toFixed(1)}" rx="3" fill="#DDE9E7" opacity=".8"/>`;
      }
      bars+=`<rect class="bar bar-in" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4"
        fill="${activa?"#EC8B5E":"url(#bg1)"}" style="animation-delay:${Math.min(i*22,500)}ms"/>`;
      hits+=`<rect class="hit" data-i="${i}" x="${(x0+slot*i).toFixed(1)}" y="${y0}" width="${slot.toFixed(1)}" height="${(y1-y0).toFixed(1)}" fill="transparent"/>`;
      const paso=Math.ceil(pts.length/(chico?5:(pts.length>26?9:16)));
      if(i%paso===0||i===pts.length-1)
        labs+=`<text x="${(x0+slot*i+slot/2).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${activa?"#C9743F":"#9AACA8"}">${esc(esHora?p.key+"h":etiqueta(GRA,p.key))}</text>`;
    });
    /* Línea de tendencia sobre las barras. En la vista por hora NO: los huecos
       del mediodía la hacen caer a cero y se lee como ruido, no como tendencia. */
    const linea = (!esHora && pts.length>2) ? `<path class="trend" d="${pts.map((p,i)=>(i?"L":"M")+(x0+slot*i+slot/2).toFixed(1)+" "+Y(p.v).toFixed(1)).join(" ")}"
        fill="none" stroke="#04635F" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".55"/>` : "";

    return `<svg viewBox="0 0 ${W} ${H}" style="height:auto;max-height:360px" role="img" aria-label="Evolución de ventas">
      <defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0AA89F"/><stop offset="1" stop-color="#048782"/></linearGradient></defs>
      ${grid}${bars}${linea}${promL}${labs}${hits}
    </svg>`;
  }

  function engancharTooltip(pts, esHora){
    const wrap=document.getElementById("evo-chart"), tt=document.getElementById("evo-tt");
    if(!wrap||!tt) return;
    const svg=wrap.querySelector("svg");
    const salir=()=>{ wrap.classList.remove("hov"); tt.classList.remove("on"); wrap.querySelectorAll(".bar.sel").forEach(b=>b.classList.remove("sel")); };
    svg.addEventListener("mouseleave", salir);
    svg.addEventListener("mousemove", ev=>{
      const t=ev.target; if(!t.classList.contains("hit")) return;
      const i=+t.dataset.i, p=pts[i]; if(!p) return;
      wrap.classList.add("hov");
      wrap.querySelectorAll(".bar.sel").forEach(b=>b.classList.remove("sel"));
      const bar=wrap.querySelector('.bar[data-i="'+i+'"]'); if(bar) bar.classList.add("sel");
      const r=t.getBoundingClientRect(), wr=wrap.getBoundingClientRect();
      const t1 = esHora ? `${p.key}:00 a ${p.key}:59` : etiquetaLarga(GRA,p.key);
      const extra = esHora
        ? (p.prev?`ayer a esta hora: ${M(p.prev)}`:"ayer no hubo ventas en esta hora")
        : (p.n?`${ent(p.n)} pedido${p.n===1?"":"s"} · ticket ${M(p.v/p.n)}`:"sin pedidos");
      tt.innerHTML=`<div class="t1">${esc(t1)}</div><div>${M(p.v)}</div><div class="t3">${esc(extra)}</div>`;
      tt.style.left=(r.left-wr.left+r.width/2)+"px";
      tt.style.top =(r.top -wr.top +r.height*0.35)+"px";
      tt.classList.add("on");
    });
    svg.addEventListener("touchstart", ev=>{ const t=document.elementFromPoint(ev.touches[0].clientX,ev.touches[0].clientY);
      if(t&&t.classList.contains("hit")) t.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,clientX:ev.touches[0].clientX,clientY:ev.touches[0].clientY})); }, {passive:true});
  }

  /* ======================= OLA 2 · cobranza, clientes, margen ======================= */
  function ola2(){
    if(V.cobranza) cargarCobranza().catch(e=>fail("dz-cob",e,"la cobranza"));
    if(V.clientes) cargarClientes().catch(e=>fail("dz-cli",e,"los clientes"));
  }

  async function cargarCobranza(){
    const [ml, cobMes, cobHoy] = await Promise.all([
      rpc("account.move.line","search_read",[domCuenta([
          ["account_id.account_type","=","asset_receivable"],["parent_state","=","posted"],
          ["full_reconcile_id","=",false],["amount_residual","!=",0]])],
        Object.assign({fields:["partner_id","amount_residual","date_maturity","date"],limit:0},CTX)),
      rpc("account.payment","read_group",[domCuenta([["payment_type","=","inbound"],["state","=","posted"],["date",">=",MES_INI]]),["amount:sum"],[]],Object.assign({lazy:false},CTX)),
      rpc("account.payment","read_group",[domCuenta([["payment_type","=","inbound"],["state","=","posted"],["date",">=",HOY]]),["amount:sum"],[]],Object.assign({lazy:false},CTX)),
    ]);
    let saldo=0, venc=0, aVencer=0;
    const B=[0,0,0,0,0], clientesVenc=new Set(), peores={};
    for(const l of ml){
      const r=l.amount_residual||0; if(Math.abs(r)<0.5) continue;
      saldo+=r;
      if(r<=0) continue;
      const f=(l.date_maturity||l.date||"").slice(0,10);
      if(f && f<HOY){
        venc+=r;
        if(l.partner_id){ clientesVenc.add(l.partner_id[0]); peores[l.partner_id[1]]=(peores[l.partner_id[1]]||0)+r; }
        const d=Math.round((dObj(HOY)-dObj(f))/86400000);
        B[d<=30?0:d<=60?1:d<=90?2:d<=120?3:4]+=r;
      }else aVencer+=r;
    }
    const cm=(cobMes[0]&&cobMes[0].amount)||0, ch=(cobHoy[0]&&cobHoy[0].amount)||0;
    const alDia=saldo>0?Math.max(0,1-venc/saldo):1;
    const COL=["#E5A93B","#EC8B5E","#D9694A","#B0413E","#7B2523"];
    const NOM=["1 a 30 días","31 a 60","61 a 90","91 a 120","+120 días"];
    const tv=B.reduce((a,b)=>a+b,0)||1;
    const peor=Object.entries(peores).sort((a,b)=>b[1]-a[1]).slice(0,3);

    put("dz-cob",`
      <div class="cx-h"><h2>💳 Cobranza</h2>${V.cobranza&&EYG.MODULOS.some(m=>m.key==="cobranzas"&&EYG.puedeVer(m,P))?`<a class="more" href="${abs("finanzas/cobranzas.html")}">Ver todo →</a>`:""}</div>
      <div class="big-l">${V.propio?"Tu cartera por cobrar":"Cuenta corriente abierta"}</div>
      <div class="big-n" data-to="${saldo}" data-fmt="money">$0</div>
      <div class="segbar" title="Composición de lo vencido por antigüedad">
        ${B.map((v,i)=>`<i style="width:${(v/tv*100).toFixed(1)}%;background:${COL[i]}"></i>`).join("")}
      </div>
      <div class="legend">${B.map((v,i)=>v>0?`<span><b style="background:${COL[i]}"></b>${NOM[i]} · ${mc(v)}</span>`:"").join("")||'<span style="color:var(--ok);font-weight:800">✅ Sin deuda vencida</span>'}</div>
      <div style="margin-top:12px">
        <div class="lv"><span class="n">🩸 Vencido</span><span class="v ${venc?"bad":"ok"}">${M(venc)}<span style="font-weight:600;color:var(--gris2);font-size:11px"> · ${ent(clientesVenc.size)} clientes</span></span></div>
        <div class="lv"><span class="n">⏳ Por vencer</span><span class="v">${M(aVencer)}</span></div>
        <div class="lv"><span class="n">💰 Cobrado este mes</span><span class="v ok">${M(cm)}</span></div>
        <div class="lv"><span class="n">📅 Cobrado hoy</span><span class="v ${ch?"ok":""}">${M(ch)}</span></div>
      </div>
      <div style="margin-top:11px"><div class="big-l">Cartera al día · ${Math.round(alDia*100)}%</div><div class="pbar"><i style="width:${(alDia*100).toFixed(1)}%"></i></div></div>
      ${peor.length?`<div style="margin-top:13px"><div class="big-l">Los 3 más atrasados</div>${peor.map(([n,v])=>
        `<div class="lv"><span class="n" style="font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:62%">${esc(n)}</span><span class="v bad">${mc(v)}</span></div>`).join("")}</div>`:""}`);
  }

  async function cargarClientes(){
    const desde60=addD(HOY,-60), desde180=addD(HOY,-180);
    const [tot, nuevos, act60, mgr] = await Promise.all([
      rpc("res.partner","search_count",[domSocios([["customer_rank",">",0]])]),
      rpc("res.partner","search_count",[domSocios([["customer_rank",">",0],["create_date",">=",MES_INI]])]),
      rpc("sale.order","read_group",[domVentas([["date_order",">=",uDesde(desde60)]]),["amount_untaxed:sum"],["partner_id"]],Object.assign({lazy:false,limit:6000},CTX)),
      V.margen ? rpc("sale.order.line","read_group",[domLineas([["order_id.date_order",">=",uDesde(MES_INI)]]),["margin:sum","price_subtotal:sum"],[]],Object.assign({lazy:false},CTX))
               : Promise.resolve([]),
    ]);
    const activos=act60.filter(g=>g.partner_id).length;
    const dormidos=Math.max(0,tot-activos);
    const cobertura=tot?activos/tot:0;
    const mg=mgr[0]||{}, base=mg.price_subtotal||0, mgPct=base?(mg.margin||0)/base*100:null;
    await LISTO1;   // "compraron hoy" sale de los pedidos que carga la ola 1
    const compraronHoy=new Set(ORD8.filter(o=>o.date===HOY).map(o=>o.cli)).size;

    put("dz-cli",`
      <div class="cx-h"><h2>👥 Clientes</h2><span class="hint">${V.propio?"tu cartera":"cartera total"}</span></div>
      <div class="big-l">Activos · compraron en 60 días</div>
      <div class="big-n" data-to="${activos}" data-fmt="ent">0</div>
      <div class="pbar" title="${Math.round(cobertura*100)}% de la cartera"><i style="width:${(cobertura*100).toFixed(1)}%"></i></div>
      <div style="margin-top:12px">
        <div class="lv"><span class="n">🗂️ Cartera total</span><span class="v">${ent(tot)}</span></div>
        <div class="lv"><span class="n">🆕 Nuevos este mes</span><span class="v ${nuevos?"ok":""}">${ent(nuevos)}</span></div>
        <div class="lv"><span class="n">😴 Sin comprar hace +60 días</span><span class="v ${dormidos?"warn":""}">${ent(dormidos)}</span></div>
        <div class="lv"><span class="n">🛒 Compraron hoy</span><span class="v">${ORD8_OK?ent(compraronHoy):"—"}</span></div>
        ${mgPct!==null?`<div class="lv"><span class="n">📐 Margen del mes</span><span class="v ${mgPct>=20?"ok":mgPct>=12?"warn":"bad"}">${mgPct.toFixed(1)}%<span style="font-weight:600;color:var(--gris2);font-size:11px"> · ${mc(mg.margin||0)}</span></span></div>`:""}
      </div>`);
  }

  /* ======================= OLA 3 · stock, tops, novedades ======================= */
  function ola3(){
    if(V.stock) cargarStock().catch(e=>fail("dz-stk",e,"el stock"));
    if(V.ventas){
      cargarProductos().catch(e=>fail("dz-prod",e,"los productos"));
      (V.equipo?cargarEquipo():cargarTopClientes()).catch(e=>fail("dz-top",e,"el ranking"));
    }
    cargarNovedades().catch(e=>fail("dz-nov",e,"las novedades"));
  }

  async function cargarStock(){
    const LOC=[["location_id.usage","=","internal"],["quantity",">",0]];
    const en6=addM(MES_INI,6);
    const [tot, vencido, prox, compras] = await Promise.all([
      rpc("stock.quant","read_group",[LOC,["value:sum","quantity:sum"],[]],Object.assign({lazy:false},CTX)),
      rpc("stock.quant","read_group",[LOC.concat([["lot_id.expiration_date","!=",false],["lot_id.expiration_date","<",HOY]]),["value:sum"],[]],Object.assign({lazy:false},CTX)),
      rpc("stock.quant","read_group",[LOC.concat([["lot_id.expiration_date",">=",HOY],["lot_id.expiration_date","<",en6]]),["value:sum"],[]],Object.assign({lazy:false},CTX)),
      rpc("purchase.order","read_group",[[["state","in",["purchase","done"]],["date_order",">=",uDesde(MES_INI)]],["amount_untaxed:sum"],[]],Object.assign({lazy:false},CTX)),
    ]);
    const val=(tot[0]&&tot[0].value)||0, un=(tot[0]&&tot[0].quantity)||0;
    const vv=(vencido[0]&&vencido[0].value)||0, vp=(prox[0]&&prox[0].value)||0;
    const cp=(compras[0]&&compras[0].amount_untaxed)||0;
    const riesgo=val?(vv+vp)/val:0;
    put("dz-stk",`
      <div class="cx-h"><h2>📦 Stock</h2>${EYG.MODULOS.some(m=>m.key==="stock"&&EYG.puedeVer(m,P))?`<a class="more" href="${abs("inventario/stock.html")}">Ver todo →</a>`:""}</div>
      <div class="big-l">Plata inmovilizada · a costo</div>
      <div class="big-n" data-to="${val}" data-fmt="money">$0</div>
      <div class="pbar" title="${Math.round(riesgo*100)}% del stock vence o está vencido"><i style="width:${(Math.min(1,riesgo)*100).toFixed(1)}%;background:linear-gradient(90deg,var(--gold),var(--bad))"></i></div>
      <div style="margin-top:12px">
        <div class="lv"><span class="n">📐 Unidades en depósito</span><span class="v">${ent(un)}</span></div>
        <div class="lv"><span class="n">☠️ Ya vencido</span><span class="v ${vv?"bad":"ok"}">${M(vv)}</span></div>
        <div class="lv"><span class="n">⏳ Vence en 6 meses</span><span class="v ${vp?"warn":"ok"}">${M(vp)}</span></div>
        <div class="lv"><span class="n">🚚 Compras del mes</span><span class="v">${M(cp)}</span></div>
      </div>
      ${(vv+vp)>0?`<div style="margin-top:11px;font-size:12px;color:var(--gris)">Hay <b>${mc(vv+vp)}</b> en riesgo de vencimiento — candidatos naturales a oferta.</div>`:""}`);
  }

  async function cargarProductos(){
    const g=await rpc("sale.order.line","read_group",
      [domLineas([["order_id.date_order",">=",uDesde(MES_INI)]]),["price_subtotal:sum","product_uom_qty:sum"],["product_id"]],
      Object.assign({lazy:false,orderby:"price_subtotal desc",limit:8},CTX));
    const rows=g.filter(r=>r.product_id).map(r=>({n:r.product_id[1], v:r.price_subtotal||0, q:r.product_uom_qty||0}));
    const max=Math.max(...rows.map(r=>r.v),1);
    put("dz-prod",`
      <div class="cx-h"><h2>🏆 Productos más vendidos</h2><span class="hint">${MES[+HOY.slice(5,7)-1]}${V.propio?" · tus ventas":""}</span></div>
      ${rows.length?`<div class="rk">${rows.map((r,i)=>`
        <div class="rkr"><span class="p">${i+1}</span>
          <span class="nm">${esc(r.n)}<span class="u">${ent(r.q)} unidades</span></span>
          <span class="va">${mc(r.v)}<span class="u">${M(r.v)}</span></span>
          <span class="rkbar"><i style="width:${(r.v/max*100).toFixed(1)}%"></i></span>
        </div>`).join("")}</div>`:`<div class="nodata">Sin ventas registradas este mes.</div>`}`);
  }

  async function cargarTopClientes(){
    const g=await rpc("sale.order","read_group",
      [domVentas([["date_order",">=",uDesde(MES_INI)]]),["amount_untaxed:sum"],["partner_id"]],
      Object.assign({lazy:false,orderby:"amount_untaxed desc",limit:8},CTX));
    const rows=g.filter(r=>r.partner_id).map(r=>({n:r.partner_id[1], v:r.amount_untaxed||0, q:r.__count||0}));
    const max=Math.max(...rows.map(r=>r.v),1);
    put("dz-top",`
      <div class="cx-h"><h2>🏬 Clientes del mes</h2><span class="hint">${MES[+HOY.slice(5,7)-1]}</span></div>
      ${rows.length?`<div class="rk">${rows.map((r,i)=>`
        <div class="rkr"><span class="p">${i+1}</span>
          <span class="nm">${esc(r.n)}<span class="u">${ent(r.q)} pedido${r.q===1?"":"s"}</span></span>
          <span class="va">${mc(r.v)}<span class="u">${M(r.v)}</span></span>
          <span class="rkbar"><i style="width:${(r.v/max*100).toFixed(1)}%"></i></span>
        </div>`).join("")}</div>`:`<div class="nodata">Sin ventas registradas este mes.</div>`}`);
  }

  async function cargarEquipo(){
    const g=await rpc("sale.order","read_group",
      [[["state","in",["sale","done"]],["date_order",">=",uDesde(MES_INI)]],["amount_untaxed:sum"],["user_id"]],
      Object.assign({lazy:false},CTX));
    await LISTO1;   // el "hoy" de cada comercial sale de los pedidos de la ola 1
    const hoyPor={}; ORD8.filter(o=>o.date===HOY).forEach(o=>{ hoyPor[o.vend]=(hoyPor[o.vend]||0)+o.amt; });
    const rows=g.filter(r=>r.user_id).map(r=>({n:r.user_id[1], v:r.amount_untaxed||0, q:r.__count||0, h:hoyPor[r.user_id[1]]||0}))
                .sort((a,b)=>b.v-a.v).slice(0,10);
    const max=Math.max(...rows.map(r=>r.v),1);
    const activosHoy=rows.filter(r=>r.h>0).length;
    put("dz-top",`
      <div class="cx-h"><h2>🎯 Equipo comercial</h2><span class="hint">${ORD8_OK?ent(activosHoy)+" de "+ent(rows.length)+" vendieron hoy":ent(rows.length)+" comerciales"}</span></div>
      ${rows.length?`<div class="rk">${rows.map((r,i)=>`
        <div class="rkr"><span class="p">${i+1}</span>
          <span class="nm">${esc(r.n)}<span class="u">${ent(r.q)} pedidos del mes${r.h?" · hoy "+mc(r.h):""}</span></span>
          <span class="va">${mc(r.v)}<span class="u">${M(r.v)}</span></span>
          <span class="rkbar"><i style="width:${(r.v/max*100).toFixed(1)}%;${r.h?"":"opacity:.55"}"></i></span>
        </div>`).join("")}</div>
        ${EYG.MODULOS.some(m=>m.key==="panel"&&EYG.puedeVer(m,P))?`<div style="margin-top:12px"><a class="more" href="${abs("comercial/comerciales.html")}">Ver el panel de cada comercial →</a></div>`:""}`
      :`<div class="nodata">Sin ventas registradas este mes.</div>`}`);
  }

  /* Novedades: mezcla lo que pasa en el negocio (Odoo) con lo nuevo del Core. */
  const NOVEDADES_CORE=[
    {f:"2026-07-29", ic:"📊", t:"Nuevo panel de inicio", d:"Este tablero: métricas en vivo, evolución de ventas por hora/día/semana/mes y novedades del negocio."},
    {f:"2026-07-28", ic:"⚙️", t:"Configuración de precios", d:"Las reglas del sincronizador ahora se editan por categoría: recargo, cortes por cantidad, IVA al costo y piso de margen."},
    {f:"2026-07-25", ic:"💡", t:"Oportunidades y Ofertas", d:"Cuando baja un costo, el sistema detecta la oportunidad y podés publicar la oferta o armar un combo para los comerciales."},
  ];
  async function cargarNovedades(){
    let ofertas=[], opos=0;
    try{ ofertas=JSON.parse(await rpc("ir.config_parameter","get_param",["eyg.ofertas"])||"[]"); }catch(e){}
    try{ opos=await rpc("product.product","search_count",[[["x_oportunidad","=",true],["x_oportunidad_archivada","=",false]]]); }catch(e){}
    const act=(ofertas||[]).filter(o=>!o.hasta||o.hasta>=HOY);

    const it=[];
    if(act.length) it.push({cls:"ok", ic:"🏷️", t:`${act.length} oferta${act.length===1?"":"s"} y combos vigentes`,
      d:act.slice(0,3).map(o=>o.titulo||(o.items||[]).map(i=>i.nombre).join(" + ")).filter(Boolean).join(" · ")||"Mirá el detalle en tu panel.",
      href:EYG.MODULOS.some(m=>m.key==="oportunidades"&&EYG.puedeVer(m,P))?abs("inventario/oportunidades.html"):null, a:"Ver ofertas"});
    if(opos && EYG.MODULOS.some(m=>m.key==="oportunidades"&&EYG.puedeVer(m,P)))
      it.push({cls:"warn", ic:"💡", t:`${opos} oportunidad${opos===1?"":"es"} esperando confirmación`,
        d:"Bajó el costo o hay sobrestock: confirmá precio, stock y vigencia para que llegue a los comerciales.",
        href:abs("inventario/oportunidades.html"), a:"Revisar ahora"});
    NOVEDADES_CORE.forEach((n,i)=>{
      const dias=Math.round((dObj(HOY)-dObj(n.f))/86400000);
      it.push({cls:"", ic:n.ic, t:esc(n.t)+(dias<=14?'<span class="tag-new">nuevo</span>':""), d:n.d,
        w:dias<=0?"hoy":dias===1?"ayer":dias<30?"hace "+dias+" días":dm(n.f)});
    });

    put("dz-nov",`
      <div class="cx-h"><h2>📣 Novedades</h2><span class="hint">del negocio y del Core</span></div>
      <div class="feed">${it.slice(0,6).map(x=>`
        <div class="fi ${x.cls}">
          <div class="fic">${x.ic}</div>
          <div class="fb"><div class="ft">${x.t}</div><div class="fd">${esc(x.d)}</div>
            ${x.href?`<a class="fa" href="${x.href}">${esc(x.a)} →</a>`:""}</div>
          ${x.w?`<div class="fw">${esc(x.w)}</div>`:""}
        </div>`).join("")}</div>`);
  }

  function pintarActividad(){
    const hoy=ORD8.filter(o=>o.date===HOY);
    const lista=(hoy.length?hoy:ORD8).slice(0,12);
    put("dz-act",`
      <div class="cx-h"><h2>⚡ Últimos pedidos</h2><span class="chip-live" style="padding:5px 10px;font-size:11px"><span class="dot"></span>${hoy.length?"hoy":"últimos días"}</span></div>
      ${lista.length?`<div class="act">${lista.map((o,i)=>`
        <div class="ai" style="animation-delay:${Math.min(i*35,400)}ms">
          <div class="nm" title="${esc(o.cli)}">${esc(o.cli)}</div>
          <div class="am">${mc(o.amt)}</div>
          <div class="mt">${esc(o.name)}${o.vend&&!V.propio?" · "+esc(o.vend):""}</div>
          <div class="hr">${o.date===HOY?o.hm+" hs":dm(o.date)}</div>
        </div>`).join("")}</div>`
      :`<div class="nodata">Todavía no hay pedidos registrados.</div>`}`);
  }

  return { main, init, ver, refrescar };
})();
