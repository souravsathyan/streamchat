import express from 'express'
import { initial } from '../controller/inital';

const router = express.Router();

router.get('/',initial)

export default router