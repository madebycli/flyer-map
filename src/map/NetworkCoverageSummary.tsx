import type { DistributionTask } from '../domain/campaign.ts';
import { networkProgress } from '../domain/streetNetwork.ts';
import { taskStatusLabel, type Language } from '../i18n.ts';

export function NetworkCoverageSummary({task,language}:{task:DistributionTask;language:Language}) {
  if(!task.network)return null;
  const progress=networkProgress([task],[]);
  const percent=(measure:number)=>(measure/task.network!.length*100).toLocaleString(language,{maximumFractionDigits:2});
  return <div>
    <p>{language==='de'?'Straßenabdeckung':'Road coverage'}: {Math.round(progress.percent)} % {language==='de'?'erledigt':'completed'}</p>
    {task.network.coverage.length?<details><summary>{language==='de'?'Markierte Teilbereiche':'Marked sections'}</summary><ul>
      {task.network.coverage.map((range,index)=><li key={index}>{percent(range.from)}–{percent(range.to)} % · {taskStatusLabel(language,range.status)}</li>)}
    </ul></details>:null}
  </div>;
}
