(function(){

  function render(q,picked,isReview,flipping,escapeHtml){
    const e=escapeHtml,answered=picked!=null,ok=answered&&picked===q.answer;
    const choices=q.choices.map((choice,i)=>`<button class="choice" ${answered?'disabled':''} onclick="pick(${i})"><span class="n">${i+1}</span><span class="t">${e(choice)}</span></button>`).join('');
    const back=answered?`<div class="quiz-face quiz-back ${ok?'ok':'ng'}" role="status">
        <h3>${ok?'정답이에요!':'아쉬워요. 정답은 '+(q.answer+1)+'번'}</h3>
        <div class="result-question">${q.big?`<strong>${e(q.big)}</strong>`:''}${e(q.question)}${q.image?`<img class="qimg" src="${e(q.image)}" alt="">`:''}</div>
        <div class="answer-row ${ok?'ok':'ng'}"><span>내가 고른 답 · ${picked+1}번</span>${e(q.choices[picked])}</div>
        ${ok?'':`<div class="answer-row ok"><span>정답 · ${q.answer+1}번</span>${e(q.choices[q.answer])}</div>`}
        ${q.explanation?`<div class="explanation"><b>풀이</b><p>${e(q.explanation)}</p></div>`:''}
      </div>`:'';
    return `<div class="quiz-card ${answered?'answered':''} ${flipping?'flipping':''}">
      <div class="quiz-face quiz-front" ${answered?'aria-hidden="true"':''}>
        <div class="qhead">${isReview?'<span class="tag">복습</span>':''}</div>
        ${q.big?`<div class="bighan" lang="ko">${e(q.big)}</div>`:''}
        <div class="qtext">${e(q.question)}</div>
        ${q.image?`<img class="qimg" src="${e(q.image)}" alt="">`:''}
        <div class="choices">${choices}</div>
      </div>
      ${back}
    </div>`;
  }

  function focus(answered){
    if(answered)document.querySelector('.quiz-card').scrollIntoView({block:'start'});
    else window.scrollTo(0,0);
  }

  function addDays(date,days){
    const [y,m,d]=date.split('-').map(Number),x=new Date(y,m-1,d+days,12);
    return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
  }
  const queueDue=x=>x.dueDate||addDays(x.date,1);
  const queueVersion=x=>x.changedAt||Date.parse((x.date||'1970-01-01')+'T00:00:00')||0;
  const shuffle=a=>{
    a=a.slice();
    for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  };

  function buildToday(deck,date,perDay,questions,byId,stats,queue){
    const inDeck=id=>byId[id]&&byId[id].deck===deck;
    const due=queue.filter(x=>x.stage!=='done'&&inDeck(x.id)&&queueDue(x)<=date)
      .sort((a,b)=>queueDue(a).localeCompare(queueDue(b))||(a.date||'').localeCompare(b.date||''));
    const reviewIds=[...new Set(due.map(x=>x.id))];
    const waiting=new Set(queue.filter(x=>x.stage!=='done'&&inDeck(x.id)).map(x=>String(x.id)));
    const rest=shuffle(questions.filter(x=>x.deck===deck).map(x=>x.id).filter(id=>!waiting.has(String(id))));
    rest.sort((a,b)=>{
      const sa=stats[a]||{seen:0,last:''},sb=stats[b]||{seen:0,last:''};
      if(sa.seen!==sb.seen)return sa.seen-sb.seen;
      return sa.last<sb.last?-1:sa.last>sb.last?1:0;
    });
    const todayIds=rest.slice(0,10);
    return {date,ids:[...reviewIds,...todayIds],reviewIds,todayIds,wrongFrom:reviewIds,res:{}};
  }

  function ensureSections(day,deck,date,perDay,questions,byId,stats,queue){
    if(!day||day.date!==date)return buildToday(deck,date,perDay,questions,byId,stats,queue);
    const fresh=buildToday(deck,date,perDay,questions,byId,stats,queue);
    const valid=id=>byId[id]&&byId[id].deck===deck;
    const reviewIds=[...new Set([...(day.reviewIds||day.wrongFrom||[]),...fresh.reviewIds])].filter(valid);
    const reviewSet=new Set(reviewIds.map(String));
    const waiting=new Set(queue.filter(x=>x.stage!=='done'&&valid(x.id)).map(x=>String(x.id)));
    const oldToday=day.todayIds||((day.ids||[]).filter(id=>!reviewSet.has(String(id))));
    const todayIds=[];
    for(const id of oldToday){
      if(!valid(id)||reviewSet.has(String(id))||waiting.has(String(id))&&!(day.res?.[id]?.tries>0)||todayIds.some(x=>String(x)===String(id)))continue;
      if(todayIds.length<10)todayIds.push(id);
    }
    for(const id of fresh.todayIds){
      if(todayIds.length>=10)break;
      if(!todayIds.some(x=>String(x)===String(id))&&!reviewSet.has(String(id)))todayIds.push(id);
    }
    return {...day,date,ids:[...reviewIds,...todayIds],reviewIds,todayIds,wrongFrom:reviewIds,res:day.res||{}};
  }

  function afterAnswer(queue,id,date,correct,everWrong,now){
    const previous=queue.find(x=>String(x.id)===String(id));
    let next;
    if(!correct)next={id,date,dueDate:addDays(date,1),stage:'wrong',changedAt:now};
    else if(previous?.stage==='done')next=previous;
    else if(previous?.stage==='review'&&queueDue(previous)<=date)next={id,date,stage:'done',changedAt:now};
    else if(previous?.stage==='review'&&queueDue(previous)>date)next=previous;
    else if(previous||everWrong)next={id,date,dueDate:addDays(date,3),stage:'review',changedAt:now};
    const result=queue.filter(x=>String(x.id)!==String(id));
    if(next)result.push(next);
    return result;
  }

  function mergeQueue(left,right){
    const result=new Map();
    for(const item of [...(left||[]),...(right||[])]){
      if(!item||item.id==null)continue;
      const key=String(item.id),old=result.get(key);
      if(!old||queueVersion(item)>queueVersion(old)||queueVersion(item)===queueVersion(old)&&item.stage==='done')result.set(key,item);
    }
    return [...result.values()];
  }

  window.QuizCard={render,focus,buildToday,ensureSections,afterAnswer,mergeQueue,queueDue};
})();
