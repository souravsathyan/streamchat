import {StreamChat} from 'stream-chat'

const apiKey = process.env.STREAM_API_KEY as string;
const apiSecret = process.env.STREAM_API_SECRET as string;

if(!apiKey || !apiSecret) throw new Error ('Missing env for Stream: please check STREAM_API_KEY and STREAM_API_SECRET');

export const serverClient = new StreamChat(apiKey,apiSecret)