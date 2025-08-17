import { Request, Response } from "express";

export const initial = (req:Request, res:Response)=>{
    res.json({message:"Inital response"})
}