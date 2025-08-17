import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import router from './routes';

const app = express();
app.use(express.json());
app.use(cors({origin:'*'}))

app.use('/', router)

const port = process.env.PORT || '3000'

app.listen(port, ()=>{
    console.log(`Server running in PORT: ${port}`)
})