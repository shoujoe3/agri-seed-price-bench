import React, { useState, useMemo, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  AGRI-SEED PRICE BENCH — an illustrative grain pricing simulator    */
/*  West Africa & East Asia · 10 crop-markets                          */
/*                                                                     */
/*  The model is a stylised, transparent reduced-form price engine.    */
/*  Elasticities are plausible values drawn from the ranges reported   */
/*  across the literature in the References tab. It is a teaching /     */
/*  scenario tool, NOT a forecasting or trading model.                 */
/* ------------------------------------------------------------------ */

/* ----------  CROP LIBRARY  ---------- */
/* base = indicative wholesale price, USD / tonne
   bHist  = price-momentum (storage/AR) exponent
   bFx    = exchange-rate pass-through exponent
   bInf   = inflation pass-through exponent
   bGdp   = demand/income exponent
   bWx    = weather->yield->price exponent (higher = more inelastic staple)
   kTrans = transport-margin sensitivity (bulkier/low-value = higher)
   sAmp   = seasonal amplitude (Sahel cereals swing more)
   harv   = harvest month index (0=Jan)
   vol    = typical monthly volatility (illustrative)               */
const CROPS = {
  wa_maize:   { region:"WA", name:"Maize",         icon:"🌽", base:280, bHist:.45,bFx:.30,bInf:.60,bGdp:.15,bWx:.95,kTrans:.34,sAmp:.18,harv:9,  vol:.11 },
  wa_rice:    { region:"WA", name:"Rice (paddy)",  icon:"🌾", base:470, bHist:.50,bFx:.50,bInf:.65,bGdp:.20,bWx:.80,kTrans:.26,sAmp:.12,harv:10, vol:.10 },
  wa_sorghum: { region:"WA", name:"Sorghum",       icon:"🌾", base:300, bHist:.40,bFx:.18,bInf:.55,bGdp:.12,bWx:1.05,kTrans:.34,sAmp:.22,harv:9, vol:.12 },
  wa_millet:  { region:"WA", name:"Pearl millet",  icon:"🌾", base:330, bHist:.40,bFx:.15,bInf:.55,bGdp:.12,bWx:1.10,kTrans:.34,sAmp:.24,harv:9, vol:.13 },
  wa_cowpea:  { region:"WA", name:"Cowpea",        icon:"🫘", base:720, bHist:.45,bFx:.22,bInf:.60,bGdp:.25,bWx:.90,kTrans:.30,sAmp:.20,harv:10, vol:.12 },

  ea_rice:    { region:"EA", name:"Rice (japonica)",icon:"🍚",base:520, bHist:.55,bFx:.35,bInf:.50,bGdp:.20,bWx:.75,kTrans:.20,sAmp:.10,harv:8, vol:.07 },
  ea_wheat:   { region:"EA", name:"Wheat",         icon:"🌾", base:300, bHist:.50,bFx:.30,bInf:.50,bGdp:.18,bWx:.70,kTrans:.22,sAmp:.12,harv:5, vol:.09 },
  ea_soybean: { region:"EA", name:"Soybean",       icon:"🫛", base:560, bHist:.50,bFx:.55,bInf:.50,bGdp:.30,bWx:.65,kTrans:.20,sAmp:.10,harv:9, vol:.10 },
  ea_maize:   { region:"EA", name:"Maize",         icon:"🌽", base:260, bHist:.50,bFx:.40,bInf:.50,bGdp:.20,bWx:.80,kTrans:.24,sAmp:.14,harv:8, vol:.09 },
  ea_foxmill: { region:"EA", name:"Foxtail millet",icon:"🌾", base:900, bHist:.40,bFx:.25,bInf:.50,bGdp:.25,bWx:.95,kTrans:.28,sAmp:.18,harv:8, vol:.11 },
};

/* ----------  GEOGRAPHY  ---------- */
/* remoteness 0 (port) -> 1 (deep interior); fx = local units per USD (indicative) */
const COUNTRIES = {
  /* West Africa */
  NG:{ region:"WA", name:"Nigeria",      cur:"₦",   fx:1600, markets:[["Lagos (port)",.12],["Kano",.70],["Maiduguri",1.0]] },
  GH:{ region:"WA", name:"Ghana",        cur:"GH₵", fx:12,   markets:[["Tema (port)",.12],["Tamale",.70]] },
  ML:{ region:"WA", name:"Mali",         cur:"CFA", fx:600,  markets:[["Bamako",.55],["Gao",1.0]] },
  SN:{ region:"WA", name:"Senegal",      cur:"CFA", fx:600,  markets:[["Dakar (port)",.10],["Kaolack",.50]] },
  BF:{ region:"WA", name:"Burkina Faso", cur:"CFA", fx:600,  markets:[["Ouagadougou",.70],["Bobo-Dioulasso",.60]] },
  NE:{ region:"WA", name:"Niger",        cur:"CFA", fx:600,  markets:[["Niamey",.85],["Zinder",1.0]] },
  /* East Asia */
  CN:{ region:"EA", name:"China",        cur:"¥",   fx:7.2,  markets:[["Guangzhou (port)",.10],["Zhengzhou",.50],["Ürümqi",1.0]] },
  JP:{ region:"EA", name:"Japan",        cur:"¥",   fx:155,  markets:[["Tokyo (port)",.10],["Sapporo",.40]] },
  KR:{ region:"EA", name:"South Korea",  cur:"₩",   fx:1380, markets:[["Busan (port)",.10],["Seoul",.20]] },
  TW:{ region:"EA", name:"Taiwan",       cur:"NT$", fx:32,   markets:[["Kaohsiung (port)",.10],["Taichung",.25]] },
  VN:{ region:"EA", name:"Vietnam",      cur:"₫",   fx:25400,markets:[["Ho Chi Minh (port)",.15],["Can Tho (Mekong)",.30]] },
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ----------  MODEL FUNCTIONS  ---------- */
function seasonalMult(month, harv, amp) {
  const diff = ((month - harv) + 12) % 12;          // 0 at harvest (trough)
  return 1 - amp * Math.cos((2 * Math.PI * diff) / 12); // peak 6 mo later (lean)
}
/* two-sided yield deviation: near-ideal rain+temp => positive (glut, price down);
   drought / flood / heat => negative (shortfall, price up)  */
function yieldShock(rainAnom, tempAnom) {
  const rainDev = rainAnom - 0.05;                       // slight surplus is ideal
  const rainEff = 0.12 - 1.5 * rainDev * rainDev;
  const tDev = tempAnom - 0.3;
  const tEff = -(tDev > 0 ? 0.05 * tDev * tDev : 0.025 * tDev * tDev);
  return Math.max(-0.6, Math.min(0.15, rainEff + tEff));
}

function computePrice(crop, remoteness, p) {
  const mHist = Math.pow(1 + p.hist, crop.bHist);
  const mEcon =
    Math.pow(1 + p.fx, crop.bFx) *
    Math.pow(1 + p.inf, crop.bInf) *
    Math.pow(p.dem, crop.bGdp);
  const sh = yieldShock(p.rain, p.temp);
  const mWx = Math.pow(1 + sh, -crop.bWx);
  const mSea = seasonalMult(p.month, crop.harv, crop.sAmp);
  const core = crop.base * mHist * mEcon * mWx * mSea;
  const mTrans = 1 + remoteness * crop.kTrans * p.fuel;
  const final = core * mTrans;
  return { mHist, mEcon, mWx, mSea, mTrans, shock: sh, core, final };
}

/* ----------  FORMATTERS  ---------- */
const fmt0 = (n) => Math.round(n).toLocaleString("en-US");
const usd = (n) => "$" + fmt0(n);
const pct = (n) => (n >= 0 ? "+" : "") + Math.round(n * 100) + "%";
const mult = (n) => "×" + n.toFixed(2);

/* ----------  SLIDER DEFINITIONS  ---------- */
const SLIDERS = [
  { key:"hist", grp:"Market",   label:"Recent price vs normal", min:-.3, max:.5,  step:.01, kind:"pct", accent:"grain",
    tip:"Storage / autoregressive momentum. Today's level anchors tomorrow's (Deaton & Laroque 1992; ARIMA studies)." },
  { key:"fx",   grp:"Economic", label:"Currency depreciation (yr)", min:-.1, max:.6, step:.01, kind:"pct", accent:"grain",
    tip:"Exchange-rate pass-through. Cereals ≈0.27–0.38 per 1% depreciation; higher for import-reliant crops (Mazorodze; Dillon & Barrett)." },
  { key:"inf",  grp:"Economic", label:"Inflation",              min:0,  max:.4,  step:.005,kind:"pct", accent:"grain",
    tip:"General price level feeds nominal grain prices (VECM long-run relationships)." },
  { key:"dem",  grp:"Economic", label:"Demand index",           min:.8, max:1.3, step:.01, kind:"x",   accent:"grain",
    tip:"Income / demand shifter. Inelastic staples move little; higher-value crops (cowpea, soybean, foxtail) more." },
  { key:"rain", grp:"Weather",  label:"Rainfall anomaly",       min:-.5,max:.5,  step:.01, kind:"pct", accent:"rain",
    tip:"Yield is an inverted-U in rainfall: both drought and flood cut output (Schlenker & Roberts 2009; excess-rain cereal models)." },
  { key:"temp", grp:"Weather",  label:"Temperature anomaly",    min:-3, max:5,   step:.1,  kind:"deg", accent:"rain",
    tip:"Heat beyond the optimum is nonlinearly damaging; inelastic demand turns shortfalls into price spikes." },
  { key:"fuel", grp:"Transport",label:"Fuel price vs normal",   min:.6, max:2,   step:.01, kind:"x",   accent:"grain",
    tip:"Diesel drives the marketing margin between farm-gate and market; larger for bulky, low-value grains & remote markets (Dillon & Barrett 2016; Mabaya 2003)." },
];
const sliderFmt = (kind, v) =>
  kind === "pct" ? pct(v) : kind === "deg" ? (v >= 0 ? "+" : "") + v.toFixed(1) + "°C" : v.toFixed(2) + "×";

/* ================================================================== */
export default function App() {
  const [tab, setTab] = useState("sim");
  const [region, setRegion] = useState("WA");
  const [countryId, setCountryId] = useState("NG");
  const [mktIdx, setMktIdx] = useState(0);
  const [cropId, setCropId] = useState("wa_maize");
  const [focus, setFocus] = useState("rain");
  const [unit, setUnit] = useState("t");            // "t" = per tonne, "kg" = per kg
  const [p, setP] = useState({
    hist:.05, fx:.15, inf:.12, dem:1.0, rain:0, temp:.5, fuel:1.0, month:6,
  });

  const country = COUNTRIES[countryId];
  const crop = CROPS[cropId];
  const remoteness = country.markets[mktIdx][1];
  const r = useMemo(() => computePrice(crop, remoteness, p), [crop, remoteness, p]);

  const switchRegion = (rg) => {
    setRegion(rg);
    const c = Object.keys(COUNTRIES).find((k) => COUNTRIES[k].region === rg);
    setCountryId(c); setMktIdx(0);
    const cr = Object.keys(CROPS).find((k) => CROPS[k].region === rg);
    setCropId(cr);
  };
  const switchCountry = (id) => { setCountryId(id); setMktIdx(0); };

  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));

  /* waterfall steps */
  const steps = [
    { label:"Base wholesale",   mlt:null,     val:crop.base },
    { label:"Price momentum",   mlt:r.mHist,  val:crop.base*r.mHist },
    { label:"Economic factors", mlt:r.mEcon,  val:crop.base*r.mHist*r.mEcon },
    { label:"Weather / yield",  mlt:r.mWx,    val:crop.base*r.mHist*r.mEcon*r.mWx },
    { label:"Seasonality",      mlt:r.mSea,   val:r.core },
    { label:"Transport margin", mlt:r.mTrans, val:r.final },
  ];
  const wfMax = Math.max(...steps.map((s) => s.val)) * 1.02;

  /* sensitivity sweep */
  const fdef = SLIDERS.find((s) => s.key === focus);
  const sweep = useMemo(() => {
    const N = 32, out = [];
    for (let i = 0; i <= N; i++) {
      const v = fdef.min + ((fdef.max - fdef.min) * i) / N;
      const pr = computePrice(crop, remoteness, { ...p, [focus]: v });
      out.push({ x: v, price: Math.round(pr.final) });
    }
    return out;
  }, [crop, remoteness, p, focus, fdef]);
  const curPrice = Math.round(r.final);

  /* ---- unit-aware display (per tonne / per kg) ---- */
  const div = unit === "kg" ? 1000 : 1;
  const unitLbl = unit === "kg" ? "/kg" : "/tonne";
  const smart = (n) =>                                     // adaptive decimals for small per-kg values
    n >= 100 ? Math.round(n).toLocaleString("en-US") : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  const money = (n) => "$" + smart(n / div);               // USD in the selected unit
  const local = (n) => country.cur + smart((n * country.fx) / div); // local currency in the selected unit

  const availCrops = Object.entries(CROPS).filter(([, c]) => c.region === region);
  const availCountries = Object.entries(COUNTRIES).filter(([, c]) => c.region === region);
  const band = crop.vol; // typical monthly range

  return (
    <div className="wrap">
      <style>{CSS}</style>

      {/* ---- masthead ---- */}
      <header className="mast">
        <div className="mast-id">
          <span className="glyph">⌗</span>
          <div>
            <h1>Agri-Seed Price Bench</h1>
            <p>A reduced-form pricing simulator · West&nbsp;Africa &amp; East&nbsp;Asia · 10 grain markets</p>
          </div>
        </div>
        <nav className="tabs">
          {[["sim","Simulator"],["model","Methodology"],["refs","References"]].map(([k,l])=>(
            <button key={k} className={tab===k?"tab on":"tab"} onClick={()=>setTab(k)}>{l}</button>
          ))}
        </nav>
      </header>

      {tab === "sim" && (
        <div className="grid">
          {/* ============ LEFT: pickers ============ */}
          <aside className="rail">
            <div className="seg">
              {[["WA","West Africa"],["EA","East Asia"]].map(([k,l])=>(
                <button key={k} className={region===k?"segb on":"segb"} onClick={()=>switchRegion(k)}>{l}</button>
              ))}
            </div>

            <label className="flabel">Country</label>
            <div className="chips">
              {availCountries.map(([id,c])=>(
                <button key={id} className={countryId===id?"chip on":"chip"} onClick={()=>switchCountry(id)}>{c.name}</button>
              ))}
            </div>

            <label className="flabel">Market · <span className="dim">remoteness from port</span></label>
            <div className="mkts">
              {country.markets.map(([nm,rm],i)=>(
                <button key={nm} className={mktIdx===i?"mkt on":"mkt"} onClick={()=>setMktIdx(i)}>
                  <span>{nm}</span>
                  <span className="rmbar"><span style={{width:`${rm*100}%`}} /></span>
                </button>
              ))}
            </div>

            <label className="flabel">Grain / seed</label>
            <div className="cropgrid">
              {availCrops.map(([id,c])=>(
                <button key={id} className={cropId===id?"cropb on":"cropb"} onClick={()=>setCropId(id)}>
                  <span className="cico">{c.icon}</span><span>{c.name}</span>
                </button>
              ))}
            </div>

            <label className="flabel">Month</label>
            <div className="months">
              {MONTHS.map((m,i)=>(
                <button key={m} className={p.month===i?"mo on":"mo"} onClick={()=>set("month",i)}>{m}</button>
              ))}
            </div>
          </aside>

          {/* ============ CENTER: readout + waterfall ============ */}
          <main className="stage">
            <div className="readout">
              <div className="ro-top">
                <div className="ro-crop">{crop.icon} {crop.name} · {country.name} · {country.markets[mktIdx][0]}</div>
                <div className="unitseg">
                  {[["t","per tonne"],["kg","per kg"]].map(([k,l])=>(
                    <button key={k} className={unit===k?"useg on":"useg"} onClick={()=>setUnit(k)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="ro-price">{money(curPrice)}<span className="ro-unit">{unitLbl}</span></div>
              <div className="ro-local">
                ≈ {local(curPrice)} {unitLbl}
                <span className="ro-band">typical monthly range {local(curPrice*(1-band))} – {local(curPrice*(1+band))}</span>
              </div>
            </div>

            {/* signature: the price-assembly ledger */}
            <div className="ledger">
              <div className="ledger-head">
                <span>How the price is assembled</span>
                <span className="dim">running value, USD{unitLbl}</span>
              </div>
              {steps.map((s,i)=>{
                const up = s.mlt!=null && s.mlt>1;
                const cls = s.mlt==null ? "base" : up ? "up" : "down";
                return (
                  <div className="lrow" key={s.label}>
                    <div className="lname">
                      <span className="lstep">{i===0?"·":i}</span>{s.label}
                    </div>
                    <div className={"lmult "+cls}>{s.mlt==null?"base":mult(s.mlt)}</div>
                    <div className="lbar"><span className={"bar "+cls} style={{width:`${(s.val/wfMax)*100}%`}} /></div>
                    <div className="lval">{money(s.val)}</div>
                  </div>
                );
              })}
              <div className="formula">
                P = {money(crop.base)} × {r.mHist.toFixed(2)} × {r.mEcon.toFixed(2)} × {r.mWx.toFixed(2)} × {r.mSea.toFixed(2)} × {r.mTrans.toFixed(2)} = <b>{money(curPrice)}{unitLbl}</b>
              </div>
              <div className="wxnote">
                Modelled yield deviation from weather: <b className={r.shock>=0?"gpos":"gneg"}>{pct(r.shock)}</b>
                {r.shock>=0 ? " (favourable → downward price pressure)" : " (shortfall → upward price pressure)"}
              </div>
            </div>

            {/* sensitivity */}
            <div className="sens">
              <div className="sens-head">
                <span>Price sensitivity to a single driver</span>
                <select value={focus} onChange={(e)=>setFocus(e.target.value)}>
                  {SLIDERS.map((s)=><option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div className="chartbox">
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={sweep} margin={{top:8,right:14,left:2,bottom:4}}>
                    <CartesianGrid stroke="rgba(236,231,214,.08)" vertical={false}/>
                    <XAxis dataKey="x" tick={{fill:"#A5A08C",fontSize:11}} stroke="rgba(236,231,214,.15)"
                      tickFormatter={(v)=>sliderFmt(fdef.kind,v)} />
                    <YAxis tick={{fill:"#A5A08C",fontSize:11}} stroke="rgba(236,231,214,.15)"
                      width={52} tickFormatter={(v)=>money(v)} domain={["auto","auto"]}/>
                    <Tooltip contentStyle={{background:"#1C1F14",border:"1px solid rgba(236,231,214,.15)",borderRadius:8,color:"#ECE7D6",fontSize:12}}
                      labelFormatter={(v)=>fdef.label+": "+sliderFmt(fdef.kind,v)}
                      formatter={(v)=>[money(v),"Price"+unitLbl]}/>
                    <ReferenceLine x={p[focus]} stroke="#E0A72C" strokeDasharray="3 3"/>
                    <Line type="monotone" dataKey="price" stroke="#E0A72C" strokeWidth={2.4} dot={false}/>
                    <ReferenceDot x={p[focus]} y={curPrice} r={4} fill="#E0A72C" stroke="#14160E"/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </main>

          {/* ============ RIGHT: sliders ============ */}
          <aside className="rail dials">
            {["Market","Economic","Weather","Transport"].map((grp)=>(
              <div className="group" key={grp}>
                <div className="ghead">{grp}</div>
                {SLIDERS.filter((s)=>s.grp===grp).map((s)=>(
                  <div className="dial" key={s.key}>
                    <div className="drow">
                      <span className="dlabel" title={s.tip}>{s.label}<i className="q">?</i></span>
                      <span className={"dval "+s.accent}>{sliderFmt(s.kind,p[s.key])}</span>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={p[s.key]}
                      className={"range "+s.accent}
                      onChange={(e)=>{ set(s.key,parseFloat(e.target.value)); setFocus(s.key); }} />
                    <div className="dtip">{s.tip}</div>
                  </div>
                ))}
              </div>
            ))}
            <button className="reset" onClick={()=>setP({hist:.05,fx:.15,inf:.12,dem:1.0,rain:0,temp:.5,fuel:1.0,month:6})}>
              Reset drivers to baseline
            </button>
          </aside>
        </div>
      )}

      {tab === "model" && <Methodology/>}
      {tab === "refs"  && <References/>}

      <footer className="foot">
        Illustrative scenario tool for teaching and exploration. Elasticities are plausible values selected within ranges reported across the cited literature — not statistically estimated for any specific market. Not price-forecasting or trading advice.
      </footer>
    </div>
  );
}

/* ================================================================== */
function Methodology() {
  return (
    <div className="doc">
      <h2>The data model, and how the simulator uses it</h2>
      <p>
        The engine is a <b>reduced-form, multiplicative (log-linear) price model</b>. This is the structural
        shape implied by the price-transmission literature: cointegration / vector error-correction models
        describe a <i>long-run log-linear equilibrium</i> between a domestic grain price and its drivers,
        and pass-through coefficients are simply the <i>elasticities</i> on those drivers. Writing the model
        multiplicatively lets every factor be read as “a&nbsp;1% move in the driver shifts price by
        β&nbsp;percent,” which is exactly what the frontend visualises.
      </p>

      <div className="eq">
        P&nbsp;=&nbsp;P<sub>base</sub> · M<sub>hist</sub> · M<sub>econ</sub> · M<sub>weather</sub> · M<sub>season</sub> · M<sub>transport</sub>
      </div>

      <h3>1 · Base price</h3>
      <p>Each of the ten crop-markets carries an indicative wholesale reference price (USD/tonne). Everything else is a multiplier on that anchor, so the assembled price is always traceable back to a real starting point.</p>

      <h3>2 · Price momentum · M<sub>hist</sub> = (P<sub>lag</sub>/P<sub>base</sub>)<sup>β<sub>hist</sub></sup></h3>
      <p>Grains are storable, so a competitive-storage / autoregressive term carries recent levels forward (β ≈ 0.4–0.55). This is the Deaton–Laroque storage insight and the persistence that ARIMA/AR studies repeatedly find. The “recent price vs normal” slider sets P<sub>lag</sub>/P<sub>base</sub>.</p>

      <h3>3 · Economic factors · M<sub>econ</sub> = (1+d)<sup>β<sub>fx</sub></sup>(1+i)<sup>β<sub>inf</sub></sup>·D<sup>β<sub>gdp</sub></sup></h3>
      <p>
        Three macro channels combine: currency depreciation <i>d</i> (exchange-rate pass-through), inflation <i>i</i>, and a demand/income index <i>D</i>.
        Pass-through is <b>incomplete</b> and crop-specific — bread &amp; cereals sit near 0.27–0.38 per 1% depreciation, higher for import-reliant crops
        (West-African milled rice, Chinese soybean) and lower for locally-grown Sahel millet and sorghum.
      </p>

      <h3>4 · Weather · M<sub>weather</sub> = (1+ŷ)<sup>−β<sub>wx</sub></sup></h3>
      <p>
        Weather enters through yield, not price directly. Modelled yield deviation <i>ŷ</i> is an <b>inverted-U in rainfall</b> (both drought and flood cut output)
        and a <b>nonlinear penalty for heat</b> above the optimum — the Schlenker–Roberts shape. Because staple demand is inelastic, a yield shortfall
        is amplified into a larger price move (β<sub>wx</sub> ≈ 0.65–1.10, highest for Sahel millet/sorghum). Favourable weather pushes ŷ positive and prices down.
      </p>

      <h3>5 · Seasonality · M<sub>season</sub></h3>
      <p>A cosine anchored on each crop’s harvest month: a harvest-time trough rising to a lean-season peak roughly six months later. Amplitude is largest for Sahel coarse grains (±18–24%) and smallest for traded/stored East-Asian staples.</p>

      <h3>6 · Transport · M<sub>transport</sub> = 1 + remoteness · κ · (Fuel/Fuel<sub>base</sub>)</h3>
      <p>
        Transport is treated as an <b>additive marketing margin</b> rather than an elasticity — faithful to the farm-gate-plus-margin view in the transport literature.
        The margin scales with a market’s remoteness from port (set by the location picker) and with diesel price. It is largest for bulky, low-value grains (maize, sorghum)
        hauled to deep-interior or landlocked markets, matching evidence that oil prices transmit into interior food prices and that transfer costs drive spatial price wedges.
      </p>

      <h3>How the frontend works</h3>
      <p>
        Every slider move recomputes the six multipliers instantly. The <b>assembly ledger</b> shows the running price after each factor (base → momentum → economic → weather → seasonality → transport),
        so you can see exactly where the money enters. The <b>sensitivity chart</b> sweeps one chosen driver across its full range while holding the others fixed, tracing the price response curve and marking your current setting.
        The country/market picker changes both the currency shown and the transport remoteness; the region toggle swaps the crop set and base prices.
      </p>
      <div className="callout">
        <b>Honesty note.</b> This is a stylised teaching engine. The elasticities are plausible values chosen within the ranges reported across the References, not estimates fitted to any one market’s data, and the base prices are indicative. Use it to build intuition about <i>how</i> drivers combine — not to forecast a real quote.
      </div>
    </div>
  );
}

/* ================================================================== */
function References() {
  const refs = [
    ["Deaton, A. & Laroque, G. (1992).","On the behaviour of commodity prices.","Review of Economic Studies 59(1).","Competitive-storage foundation for price persistence (M_hist)."],
    ["Schlenker, W. & Roberts, M.J. (2009).","Nonlinear temperature effects indicate severe damages to U.S. crop yields under climate change.","PNAS 106(37).","Nonlinear heat–yield response used in M_weather."],
    ["Dillon, B.M. & Barrett, C.B. (2016).","Global oil prices and local food prices: evidence from East Africa.","American Journal of Agricultural Economics 98(1), 154–171.","Fuel→transport→interior food-price transmission."],
    ["Rapsomanikis, G., Hallam, D. & Conforti, P. (2006).","Market integration and price transmission in selected food and cash crop markets of developing countries.","FAO Commodity Market Review.","VECM/ECM price-transmission framework."],
    ["Ceballos, F., Hernandez, M.A., Minot, N. & Robles, M. (2017).","Grain price and volatility transmission from international to domestic markets in developing countries.","World Development 94.","MGARCH volatility transmission; informs vol bands."],
    ["Crespo Cuaresma, J., Hlouskova, J. & Obersteiner, M. (2021).","Agricultural commodity price dynamics and their determinants: a comprehensive econometric approach.","Journal of Forecasting 40(7), 1245–1273.","Multi-driver econometric determinants of grain prices."],
    ["Ahumada, H. & Cornejo, M. (2016).","Forecasting food prices: the case of corn, soybeans and wheat.","International Journal of Forecasting 32(3), 838–848.","Cross-commodity price forecasting structure."],
    ["Mazorodze, B.T. (2025).","Exchange rate pass-through to food prices in South Africa.","Cogent Food & Agriculture (Taylor & Francis).","≈0.34 pass-through for bread & cereals; calibrates β_fx."],
    ["Willenbockel, D. (2012).","Extreme weather events and crop price spikes in a changing climate.","Oxfam Research Report (GLOBE CGE simulation).","Weather-shock → price-spike simulation for rice/maize/wheat."],
    ["(2022).","Market integration and price transmission in the regional grain markets in Ethiopia.","Journal of Applied Economics / Cogent (Taylor & Francis).","Threshold-VECM asymmetric transmission."],
    ["An attribution analysis of soybean price volatility in China.","Global market connectedness vs energy-market transmission.","Int'l Food and Agribusiness Management Review.","Import-dependent β_fx for East-Asian soybean."],
    ["Dynamic influence of international price fluctuation on soybean market price in China (Bayesian-VAR).","","Frontiers in Sustainable Food Systems (2025).","Exogenous FX & foreign-price drivers of domestic soybean."],
    ["Forecasting international market prices for rice, corn and soybeans using ARIMA.","","International Journal of Agricultural Economics (2025).","Persistence/volatility structure for staple grains."],
    ["Sun, K., Yao, Q. & Li, Y. (2025).","A novel agricultural commodity price prediction model integrating deep learning and swarm intelligence.","PLOS ONE, 10.1371/journal.pone.0337103.","Nonlinear multi-factor corn & wheat price drivers."],
    ["Mabaya, E. (2003).","Smallholder agricultural markets: organisation, spatial integration and equilibrium; transportation costs and spatial integration in Africa.","Cornell University.","Transfer costs drive spatial price wedges (M_transport)."],
    ["Hybrid forecasting of agricultural commodity prices: integrating machine learning, time series and stochastic simulation (2025).","","Journal of Commodity Markets.","Comparative review of price-simulation methodologies."],
    ["Mechanisms and modelling approaches for excessive-rainfall stress on cereals (2023).","","Agricultural and Forest Meteorology.","Flood/waterlogging yield loss (inverted-U rainfall term)."],
    ["Manogna, R.L. & Mishra, A.K. (2021).","Forecasting spot prices of agricultural commodities in India: neural-network approaches.","(referenced in hybrid-model reviews).","Evidence for nonlinear price dynamics."],
  ];
  return (
    <div className="doc">
      <h2>Peer-reviewed literature ({refs.length} sources)</h2>
      <p className="dim" style={{marginTop:"-.4rem"}}>Each source maps to a component of the model. Titles/venues are drawn from the published record; consult the originals for the exact estimates.</p>
      <ol className="reflist">
        {refs.map((rf,i)=>(
          <li key={i}>
            <span className="rn">{String(i+1).padStart(2,"0")}</span>
            <div>
              <span className="ra">{rf[0]}</span> <span className="rt">{rf[1]}</span> <span className="rv">{rf[2]}</span>
              <div className="ruse">↳ {rf[3]}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ================================================================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.wrap{
  --soil:#14160E;--soil2:#1C1F14;--soil3:#242818;
  --line:rgba(236,231,214,.10);--line2:rgba(236,231,214,.18);
  --bone:#ECE7D6;--dim:#A5A08C;
  --grain:#E0A72C;--grain2:#F0C766;--sage:#8FB07A;--rain:#7FA6C4;--brick:#C56A3E;
  font-family:'Inter',system-ui,sans-serif;color:var(--bone);background:
    radial-gradient(1200px 600px at 80% -10%, rgba(224,167,44,.06), transparent 60%),
    var(--soil);
  min-height:100vh;padding:20px;box-sizing:border-box;
}
.wrap *{box-sizing:border-box}
h1,h2,h3{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;letter-spacing:-.02em;margin:0}
.dim{color:var(--dim)}
.gpos{color:var(--sage)} .gneg{color:var(--brick)}

/* masthead */
.mast{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;
  border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:18px}
.mast-id{display:flex;gap:14px;align-items:center}
.glyph{font-size:34px;color:var(--grain);line-height:1}
.mast h1{font-size:24px}
.mast p{margin:2px 0 0;color:var(--dim);font-size:13px}
.tabs{display:flex;gap:4px;background:var(--soil2);border:1px solid var(--line);border-radius:10px;padding:4px}
.tab{background:none;border:0;color:var(--dim);font:600 13px 'Inter';padding:7px 14px;border-radius:7px;cursor:pointer}
.tab.on{background:var(--grain);color:#231a05}
.tab:hover:not(.on){color:var(--bone)}

/* layout */
.grid{display:grid;grid-template-columns:250px minmax(0,1fr) 300px;gap:16px;align-items:start}
.rail{background:var(--soil2);border:1px solid var(--line);border-radius:14px;padding:14px}
.flabel{display:block;font:600 11px 'Inter';text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:16px 0 8px}
.flabel:first-of-type{margin-top:14px}

.seg{display:flex;background:var(--soil);border:1px solid var(--line);border-radius:10px;padding:4px;gap:4px}
.segb{flex:1;background:none;border:0;color:var(--dim);font:600 12px 'Inter';padding:8px;border-radius:7px;cursor:pointer}
.segb.on{background:var(--grain);color:#231a05}

.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{background:var(--soil);border:1px solid var(--line);color:var(--bone);font:500 12px 'Inter';padding:6px 10px;border-radius:8px;cursor:pointer}
.chip.on{border-color:var(--grain);background:rgba(224,167,44,.14);color:var(--grain2)}
.chip:hover:not(.on){border-color:var(--line2)}

.mkts{display:flex;flex-direction:column;gap:6px}
.mkt{display:flex;flex-direction:column;gap:5px;background:var(--soil);border:1px solid var(--line);border-radius:9px;padding:8px 10px;cursor:pointer;text-align:left;color:var(--bone);font:500 12.5px 'Inter'}
.mkt.on{border-color:var(--grain)}
.rmbar{height:4px;background:rgba(236,231,214,.10);border-radius:3px;overflow:hidden}
.rmbar>span{display:block;height:100%;background:linear-gradient(90deg,var(--sage),var(--brick))}

.cropgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cropb{display:flex;align-items:center;gap:7px;background:var(--soil);border:1px solid var(--line);border-radius:9px;padding:8px;cursor:pointer;color:var(--bone);font:500 12px 'Inter';text-align:left}
.cropb.on{border-color:var(--grain);background:rgba(224,167,44,.12)}
.cico{font-size:15px}

.months{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
.mo{background:var(--soil);border:1px solid var(--line);color:var(--dim);font:500 11px 'IBM Plex Mono';padding:6px 0;border-radius:6px;cursor:pointer}
.mo.on{background:var(--grain);color:#231a05;border-color:var(--grain)}

/* center */
.stage{display:flex;flex-direction:column;gap:16px;min-width:0}
.readout{background:linear-gradient(180deg,var(--soil3),var(--soil2));border:1px solid var(--line);border-radius:16px;padding:20px 22px}
.ro-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.unitseg{display:flex;gap:4px;background:var(--soil);border:1px solid var(--line);border-radius:8px;padding:3px;flex-shrink:0}
.useg{background:none;border:0;color:var(--dim);font:600 11px 'Inter';padding:5px 10px;border-radius:6px;cursor:pointer}
.useg.on{background:var(--grain);color:#231a05}
.useg:hover:not(.on){color:var(--bone)}
.ro-crop{color:var(--dim);font:600 13px 'Inter'}
.ro-price{font-family:'Bricolage Grotesque';font-weight:800;font-size:56px;line-height:1.02;margin-top:6px;color:var(--grain);letter-spacing:-.03em}
.ro-unit{font-size:20px;color:var(--dim);margin-left:6px;font-weight:600}
.ro-local{font:500 14px 'IBM Plex Mono';color:var(--bone);margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.ro-band{color:var(--dim);font-size:12px}

.ledger{background:var(--soil2);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.ledger-head{display:flex;justify-content:space-between;font:600 12px 'Inter';text-transform:uppercase;letter-spacing:.06em;color:var(--bone);margin-bottom:12px}
.ledger-head .dim{text-transform:none;letter-spacing:0;font-weight:500}
.lrow{display:grid;grid-template-columns:150px 62px 1fr 74px;align-items:center;gap:10px;padding:5px 0}
.lname{font:500 13px 'Inter';display:flex;align-items:center;gap:8px}
.lstep{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;border-radius:5px;background:var(--soil);border:1px solid var(--line);font:600 10px 'IBM Plex Mono';color:var(--dim)}
.lmult{font:600 12px 'IBM Plex Mono';text-align:right}
.lmult.base{color:var(--dim)} .lmult.up{color:var(--brick)} .lmult.down{color:var(--sage)}
.lbar{height:16px;background:rgba(236,231,214,.05);border-radius:5px;overflow:hidden}
.bar{display:block;height:100%;border-radius:5px}
.bar.base{background:rgba(236,231,214,.25)}
.bar.up{background:linear-gradient(90deg,var(--grain),var(--brick))}
.bar.down{background:linear-gradient(90deg,var(--grain),var(--sage))}
.lval{font:600 13px 'IBM Plex Mono';text-align:right}
.formula{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font:500 13px 'IBM Plex Mono';color:var(--dim);overflow-x:auto;white-space:nowrap}
.formula b{color:var(--grain);font-weight:600}
.wxnote{margin-top:8px;font:500 12.5px 'Inter';color:var(--dim)}

.sens{background:var(--soil2);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.sens-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;font:600 12px 'Inter';text-transform:uppercase;letter-spacing:.06em}
.sens-head select{background:var(--soil);color:var(--bone);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:500 12px 'Inter';cursor:pointer;text-transform:none;letter-spacing:0}
.chartbox{margin:0 -4px}

/* dials */
.dials{display:flex;flex-direction:column;gap:14px}
.group{}
.ghead{font:800 12px 'Bricolage Grotesque';text-transform:uppercase;letter-spacing:.08em;color:var(--grain2);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.dial{margin-bottom:14px}
.drow{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
.dlabel{font:500 12.5px 'Inter';color:var(--bone);cursor:help;position:relative}
.q{display:inline-flex;width:13px;height:13px;align-items:center;justify-content:center;border:1px solid var(--line2);border-radius:50%;font-size:8px;font-style:normal;color:var(--dim);margin-left:5px;vertical-align:middle}
.dval{font:600 12px 'IBM Plex Mono'}
.dval.grain{color:var(--grain)} .dval.rain{color:var(--rain)}
.dtip{font:400 10.5px 'Inter';color:var(--dim);line-height:1.4;margin-top:6px;max-height:0;overflow:hidden;opacity:0;transition:max-height .25s,opacity .25s}
.dial:hover .dtip{max-height:80px;opacity:1}

input.range{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:3px;background:rgba(236,231,214,.14);outline:none}
input.range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--grain);border:2px solid var(--soil);cursor:pointer;box-shadow:0 0 0 1px var(--grain)}
input.range.rain::-webkit-slider-thumb{background:var(--rain);box-shadow:0 0 0 1px var(--rain)}
input.range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--grain);border:2px solid var(--soil);cursor:pointer}
input.range.rain::-moz-range-thumb{background:var(--rain)}
input.range:focus-visible{box-shadow:0 0 0 3px rgba(224,167,44,.35)}

.reset{width:100%;background:none;border:1px solid var(--line2);color:var(--dim);font:600 12px 'Inter';padding:9px;border-radius:9px;cursor:pointer;margin-top:4px}
.reset:hover{color:var(--bone);border-color:var(--bone)}

/* docs */
.doc{max-width:860px;margin:0 auto;background:var(--soil2);border:1px solid var(--line);border-radius:16px;padding:28px 30px}
.doc h2{font-size:24px;margin-bottom:12px}
.doc h3{font-size:15px;color:var(--grain2);margin:22px 0 6px;font-weight:600}
.doc p{font-size:14px;line-height:1.65;color:#D7D2C1;margin:8px 0}
.eq{font:600 17px 'IBM Plex Mono';color:var(--grain);background:var(--soil);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;text-align:center;overflow-x:auto}
.callout{margin-top:22px;background:rgba(224,167,44,.08);border:1px solid rgba(224,167,44,.3);border-radius:10px;padding:14px 16px;font-size:13.5px;line-height:1.6}
.reflist{list-style:none;padding:0;margin:14px 0 0;counter-reset:none}
.reflist li{display:flex;gap:12px;padding:11px 0;border-top:1px solid var(--line);font-size:13px;line-height:1.5}
.rn{font:600 12px 'IBM Plex Mono';color:var(--grain);flex-shrink:0}
.ra{font-weight:600;color:var(--bone)} .rt{color:#D7D2C1} .rv{color:var(--dim);font-style:italic}
.ruse{color:var(--sage);font-size:12px;margin-top:3px}

.foot{max-width:1100px;margin:22px auto 0;color:var(--dim);font-size:11.5px;line-height:1.5;text-align:center;border-top:1px solid var(--line);padding-top:14px}

@media(max-width:1080px){
  .grid{grid-template-columns:1fr}
  .rail{order:0}
  .stage{order:1}
  .dials{order:2}
  .ro-price{font-size:44px}
  .lrow{grid-template-columns:120px 52px 1fr 62px}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;
