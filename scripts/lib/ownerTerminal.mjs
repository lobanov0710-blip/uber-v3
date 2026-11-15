import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
export function privateTerminal(){if(!process.stdin.isTTY||!process.stdout.isTTY||typeof process.stdin.setRawMode!=='function'||process.env.CI)throw new Error('Private interactive owner terminal required');}
export async function ask(prompt){const r=createInterface({input:process.stdin,output:process.stdout});try{return (await r.question(prompt)).trim();}finally{r.close();}}
export async function confirm(phrase){if(await ask('Type exactly "'+phrase+'" to continue: ')!==phrase)throw new Error('Owner confirmation not provided');}
export async function hidden(prompt){
 privateTerminal();const input=process.stdin,output=process.stdout;let value='',finished=false;const oldRaw=input.isRaw===true;
 return new Promise((resolve,reject)=>{
  const end=(error)=>{if(finished)return;finished=true;input.removeListener('keypress',keypress);input.setRawMode(oldRaw);input.pause();output.write('\n');const result=value;value='';error?reject(new Error('Owner input cancelled')):resolve(result);};
  const keypress=(text,key={})=>{if(key.ctrl&&key.name==='c')return end(true);if(key.name==='return'||key.name==='enter')return end(false);
   if(key.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
   if(key.ctrl||key.meta||key.name==='escape'||key.name==='tab')return;
   if(typeof text==='string'&&value.length+text.length<=128)value+=text;
  };
  readline.emitKeypressEvents(input);input.setRawMode(true);input.resume();input.on('keypress',keypress);output.write(prompt);
 });
}
