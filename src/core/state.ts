import type { State } from './model.ts';
export function createState(runtimeId:string,epoch:number):State {
  if(!runtimeId||!Number.isSafeInteger(epoch)||epoch<1)throw new Error('Некорректная среда');
  return {schemaVersion:1,stateVersion:0,runtime:{id:runtimeId,epoch,paused:false},users:{},subscriptions:{},events:{},participation:{},notifications:{},processedUpdates:{},sourceState:{},operations:[]};
}
