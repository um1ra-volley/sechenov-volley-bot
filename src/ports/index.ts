export type {Clock,HttpClient,HttpResponse,StateRepository,TelegramTransport,SourceSnapshot} from '../core/model.ts';
import type {SourceSnapshot} from '../core/model.ts';
export interface ScheduleSource {readEvents():SourceSnapshot[]}
