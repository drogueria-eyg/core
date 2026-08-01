/* ===== EyG · motor compartido de comisión / nivel / salud (puro, sin datos) ===== */
window.EYGM = (function(){
  const RATES={ inst:{base:.020,high:.030}, farm:{base:.025,high:.035} };
  const EXTERNOS=["Samanta Luna"];
  const PERFIL={ inst:{valor:38,activ:12,nom:"Instituciones"}, farm:{valor:25,activ:25,nom:"Farmacias"} };
  const NIV=[{n:"Bronce",e:"🥉",m:1},{n:"Plata",e:"🥈",m:1.05},{n:"Oro",e:"🥇",m:1.10},{n:"Platino",e:"💎",m:1.15},{n:"Diamante",e:"👑",m:1.20}];
  const cl=(x,a,b)=>Math.max(a,Math.min(b,x));

  function perfilDe(nombre, avgTicket){ if(EXTERNOS.includes(nombre)) return "externo"; return (avgTicket||0)>=300000?"inst":"farm"; }

  // d = {nombre, perfil, factMes, factBaseline, cobradoMes, objetivoCobro, vencido, porCobrar, fichasPct, nuevos, actividadRatio, combos, avgTicket, diaMesFrac}
  function salud(d){
    if(d.perfil==="externo") return {salud:100, penaltyPt:0, items:[]};
    const venc=d.porCobrar>0?d.vencido/d.porCobrar:0;
    const esperado=(d.factBaseline||0)*(d.diaMesFrac||1);
    const factRatio=esperado>0?d.factMes/esperado:1;
    const pV=cl((venc-0.10)/0.40,0,1)*45, pF=cl((1-factRatio)/0.30,0,1)*30, pO=cl((0.40-(d.fichasPct||0))/0.40,0,1)*25;
    const s=Math.max(0,100-pV-pF-pO);
    return {salud:s, penaltyPt:(100-s)/100,
      items:[{ic:"🩸",lab:"Vencido de cartera",pts:pV,max:45,det:Math.round(venc*100)+"% vencido"},
             {ic:"📉",lab:"Facturado vs piso",pts:pF,max:30,det:Math.round(factRatio*100)+"% del ritmo"},
             {ic:"🗂️",lab:"Fichas",pts:pO,max:25,det:Math.round((d.fichasPct||0)*100)+"%"}]};
  }
  function nivel(d){
    if(d.perfil==="externo") return {nombre:"Externo",emoji:"🔵",mult:1,pts:0,params:[],perfil:"Externo"};
    const sp=PERFIL[d.perfil]||PERFIL.farm; const P=[];
    const rV=d.objetivoCobro>0?Math.min(d.cobradoMes/d.objetivoCobro,1):0; P.push({ic:"💰",lab:"Cobro vs objetivo",max:sp.valor,pts:sp.valor*rV,det:Math.round(rV*100)+"%"});
    const rA=cl(d.actividadRatio||0,0,1); P.push({ic:"📞",lab:"Actividad",max:sp.activ,pts:sp.activ*rA,det:Math.round(rA*100)+"%"});
    const rC=Math.min((d.combos||0)/5,1); P.push({ic:"🎁",lab:"Combos",max:25,pts:25*rC,det:(d.combos||0)+"/5"});
    const rN=Math.min((d.nuevos||0)/3,1); P.push({ic:"🆕",lab:"Nuevos",max:20,pts:20*rN,det:(d.nuevos||0)+" este mes"});
    const pts=P.reduce((s,p)=>s+p.pts,0), idx=pts<40?0:pts<60?1:pts<80?2:pts<95?3:4;
    return {nombre:NIV[idx].n,emoji:NIV[idx].e,mult:NIV[idx].m,pts,params:P,perfil:sp.nom};
  }
  function comision(d){
    const rt=d.perfil==="externo"?{base:.03,high:.04}:(RATES[d.perfil]||RATES.farm);
    const pen=d.perfil==="externo"?0:salud(d).penaltyPt/100;
    const rB=Math.max(0,rt.base-pen), rH=Math.max(0,rt.high-pen);
    const corte=d.perfil==="externo"?50e6:(d.factBaseline||0)*1.2;   // meta = baseline +20% (marginal)
    const base=d.factMes<=corte?d.factMes*rB:corte*rB+(d.factMes-corte)*rH;
    const mult=d.perfil==="externo"?1:nivel(d).mult;
    return {base, mult, total:base*mult, corte, rt, penaltyPt: d.perfil==="externo"?0:salud(d).penaltyPt};
  }
  return { perfilDe, salud, nivel, comision, RATES, PERFIL, NIV, EXTERNOS };
})();
