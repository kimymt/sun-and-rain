// UI fixtures only: no API requests, persistence, or forecast comparison engine.
(() => {
  const $ = id => document.getElementById(id);
  const colors = { rain: '#417d9c', sun: '#bb861c', uv: '#98583d', temp: '#294f43' };
  const fixtures = {
    rain: { start:10, title:'午後から雨', temp:[25,26,27,27,26,25,24,23,22,22,21,21,20], prob:[10,10,10,15,25,40,60,75,70,45,25,20,15], amount:[0,0,0,0,0,0.2,0.8,1.8,1.2,0.4,0,0,0], sun:[45,55,50,35,20,10,5,0,0,0,0,0,0], uv:[3,4,5,4,3,2,1,0.5,0,0,0,0,0] },
    sun: { start:10, title:'日照が続く', temp:[25,26,27,28,28,27,26,25,24,23,22,21,20], prob:[5,5,5,5,10,10,5,5,5,5,5,5,5], amount:Array(13).fill(0), sun:[50,55,55,55,50,45,35,10,0,0,0,0,0], uv:[4,5,6,6,5,4,2,0.5,0,0,0,0,0] },
    night: { start:21, title:'夜から朝', temp:[21,20,20,19,19,18,18,18,19,20,22,24,25], prob:[20,15,10,10,10,10,15,15,10,10,10,10,10], amount:Array(13).fill(0), sun:[0,0,0,0,0,0,0,0,0,15,40,50,55], uv:[0,0,0,0,0,0,0,0,0,0.5,1,2,3] }
  };
  let scenario = 'rain', selected = 6;
  const windowOffset = 35 / 60;
  let data;
  const h = n => ((n % 24) + 24) % 24;
  const time = n => `${h(n)}時`;
  const interval = i => `${data.start+i>=24?'翌日 ':''}${h(data.start+i)}–${h(data.start+i+1)}時`;
  const valueText = (value, suffix) => value == null ? 'データなし' : `${value}${suffix}`;
  const x = hour => (hour-windowOffset)/12*100;
  const changed = i => (scenario==='rain' || scenario==='stale') && [6,7].includes(i);
  const night = i => { const hour=h(data.start+i); return hour>=18 || hour<6; };
  const weather = i => data.amount[i] == null ? '天気データなし' : data.amount[i] >= .2 ? '雨' : data.sun[i] == null ? '天気データなし' : night(i) ? '晴れ・夜間' : data.sun[i]>=30 ? '晴れ' : '曇り';
  function fixture() {
    const base = fixtures[scenario] || fixtures.rain;
    data = JSON.parse(JSON.stringify(base));
    if (scenario==='missing') for (const key of ['prob','amount','sun','uv','temp']) for (const i of [5,6,7]) data[key][i]=null;
  }
  function segmentPath(values, maximum, minimum=0) {
    let path='', drawing=false;
    values.forEach((v,i) => {
      if(v==null){drawing=false;return;}
      // Instant temperatures sit on the hour; probabilities use interval centres.
      const px=x(i+(minimum===0?.5:0)), py=49-(v-minimum)/(maximum-minimum)*40;
      path+=`${drawing?'L':'M'}${px.toFixed(2)},${py.toFixed(2)} `;drawing=true;
    });
    return path;
  }
  function plot(metric) {
    const series=data[metric];
    const max=metric==='prob'?100:metric==='amount'?Math.max(3,...series.filter(v=>v!=null)):metric==='sun'?60:metric==='uv'?Math.max(11,...series.filter(v=>v!=null)):30;
    const min=metric==='temp'?15:0;
    const color=colors[metric==='prob'||metric==='amount'?'rain':metric];
    let elements=`<defs><pattern id="missing-${metric}" width="3" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L3 0" stroke="#cbd0c9" stroke-width=".45"/></pattern></defs>`;
    for(let i=0;i<13;i++) {
      const left=x(i), width=100/12;
      if(night(i)) elements+=`<rect x="${left}" y="0" width="${width}" height="56" fill="#eef0ed"/>`;
      if(series[i]==null) elements+=`<rect data-missing="true" x="${left}" y="5" width="${width}" height="47" fill="url(#missing-${metric})"/>`;
      if(changed(i) && ['prob','amount','sun'].includes(metric)) elements+=`<path d="M${left+1} 3H${left+width-1}" stroke="#89573e" stroke-width="1.6" stroke-dasharray="2 1"/>`;
      elements+=`<path d="M${left} 0V56" stroke="#e4e8e0" stroke-width=".25"/>`;
    }
    elements+=`<rect x="${x(selected)}" y="0" width="${100/12}" height="56" fill="#223c35" opacity=".07"/><path d="M${x(selected+.5)} 0V56" stroke="#223c35" stroke-width=".4" stroke-dasharray="1 1"/>`;
    if(['prob','temp'].includes(metric)) {
      elements+=`<path d="${segmentPath(series,max,min)}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`;
      series.forEach((v,i)=>{if(v!=null)elements+=`<circle cx="${x(i+(metric==='temp'?0:.5))}" cy="${49-(v-min)/(max-min)*40}" r=".75" fill="${color}"/>`;});
    } else {
      series.forEach((v,i)=>{if(v!=null && v>0)elements+=`<rect x="${x(i)+1.2}" y="${49-v/max*40}" width="${100/12-2.4}" height="${v/max*40}" rx=".6" fill="${color}" opacity="${metric==='sun'?'.78':'.88'}"/>`;});
    }
    return `<svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true" style="overflow:hidden">${elements}</svg><span class="scale">${max}${metric==='prob'?'%':metric==='temp'?'°':''}</span>`;
  }
  function renderTracks() {
    const tracks=[['prob','雨','確率 %'],['amount','降水量','mm / 時'],['sun','日照','分 / 時'],['uv','UV','1時間平均'],['temp','気温','℃・正時']];
    $('tracks').innerHTML=tracks.map(([key,label,unit])=>`<div class="track ${key==='amount'?'rain-amount':''}"><div class="track-label">${label}<small>${unit}</small></div><div class="plot" data-metric="${key}">${plot(key)}</div></div>`).join('');
    $('tracks').querySelectorAll('.plot').forEach(el=>{
      const selectAt = e => { const r=el.getBoundingClientRect(); const fraction=Math.max(0,Math.min(1,(e.clientX-r.left)/(r.width-22))); setSelection(Math.min(12,Math.floor(windowOffset+fraction*12)),false); };
      el.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'){el.setPointerCapture(e.pointerId);selectAt(e);} });
      el.addEventListener('pointermove',e=>{if(e.buttons===1&&e.pointerType==='mouse')selectAt(e);});
      el.addEventListener('click',selectAt);
    });
  }
  function metric(label,key,unit,before) {
    const v=data[key][selected];
    return `<div class="metric"><dt>${label}</dt><dd${v==null?' class="no-data"':''}>${v==null?'データなし':`${v}<small>${unit}</small>`}${before!=null?`<span class="before">前回 ${before}${unit} → 今回 ${v}${unit}</span>`:''}</dd></div>`;
  }
  function renderSelection() {
    $('selected-heading').textContent=interval(selected);
    $('hour-selector').value=selected;
    $('hour-selector').setAttribute('aria-valuetext',interval(selected));
    $('previous').disabled=selected===0; $('next').disabled=selected===12;
    const isChanged=changed(selected);
    $('selection-content').innerHTML=`<p class="weather-description">${time(data.start+selected)}の予報：${weather(selected)} <strong>${valueText(data.temp[selected],'℃')}</strong></p><dl class="metric-grid">${metric('降水確率','prob','%',isChanged?20:null)}${metric('降水量 / 1時間','amount','mm',isChanged ? 0 : null)}${metric('日照見込み / 1時間','sun','分',isChanged?45:null)}${metric('UV / 1時間平均','uv','',null)}</dl><p class="supplement">${data.temp[selected]==null?'湿度・風速：データなし':`${time(data.start+selected)}の湿度 ${data.amount[selected]>0?82:62}% · 風速 ${data.amount[selected]>0?'2.6':'1.8'} m/s`}</p><p class="interval-note">${selected===0?`現在は${time(data.start)}35分。数値は${interval(0)}全体の予報です。`:selected===12?`表示は${time(data.start+12)}35分まで。数値は${interval(12)}全体の予報です。`:'降水・日照・UVはこの1時間の値です。'}${night(selected)?' 夜間の日照見込みは0分です。':''}</p>`;
  }
  function setSelection(i, redraw=true) {
    selected=Math.max(0,Math.min(12,i));renderSelection();
    // Retain plot nodes during pointer movement so pointer capture is stable.
    if(redraw)renderTracks();
    else $('tracks').querySelectorAll('.plot').forEach(el=>{el.innerHTML=plot(el.dataset.metric);});
  }
  function render() {
    fixture();
    $('period').textContent=`9月27日（日） ${h(data.start)}:35 → ${data.start+12>=24?'翌日 ':''}${h(data.start+12)}:35`;
    $('comparison-time').textContent=scenario==='stale'?'前回 昨日21:10表示':scenario==='night'?'前回 18:10表示':'前回 09:10表示';
    const hasChanges=scenario==='rain'||scenario==='stale';
    $('change-summary').innerHTML=hasChanges?'<p><strong>16–18時の降水確率が上昇</strong></p><p>16–17時：20% → 60% · 日照見込みも減少</p>':scenario==='missing'?'<p>一部の時間はデータがなく、比較できません。</p>':'<p>強調対象の変化はありません。</p>';
    $('all-changes').hidden=!hasChanges;
    $('all-changes').open=false;
    $('change-list').innerHTML='<p>16–17時：降水確率20% → 60%、日照45分 → 5分</p><p>17–18時：降水確率20% → 75%、日照45分 → 0分</p><p>この変更内容も画面確認用の架空データです。</p>';
    $('freshness').textContent=scenario==='stale'?'03:35取得 · 保存予報':`${h(data.start)}:30取得`;
    $('stale-notice').hidden=scenario!=='stale';
    $('ticks').innerHTML=[windowOffset,2,4,6,8,10,12+windowOffset].map((i,n)=>`<span class="tick" style="left:${x(i)}%">${n===0?'今':n===6?`${h(data.start+12)}:35`:h(data.start+i)===0?'翌0時':`${h(data.start+i)}時`}</span>`).join('');
    $('accessible-list').innerHTML=data.temp.map((v,i)=>`<section class="hourly-entry"><h3>${interval(i)}${changed(i)?' · 前回から変更':''}</h3><p>降水確率 ${valueText(data.prob[i],'%')}、降水量 ${valueText(data.amount[i],'mm')}</p><p>日照 ${valueText(data.sun[i],'分')}、UV平均 ${valueText(data.uv[i],'')}</p><p>${time(data.start+i)}：${weather(i)}、${valueText(v,'℃')}</p></section>`).join('');
    setSelection(selected);
  }
  $('scenario').addEventListener('change',e=>{scenario=e.target.value; selected=scenario==='night'?9:6;render();});
  $('previous').addEventListener('click',()=>setSelection(selected-1));
  $('next').addEventListener('click',()=>setSelection(selected+1));
  $('hour-selector').addEventListener('input',e=>setSelection(Number(e.target.value)));
  render();
})();
