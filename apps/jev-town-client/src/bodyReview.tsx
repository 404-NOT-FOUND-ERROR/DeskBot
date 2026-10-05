import {createRoot} from 'react-dom/client';
import {BodyReviewPanel} from './deskbot/BodyReviewPanel.tsx';
import './styles.css';

const query=new URLSearchParams(location.search);
const reviewRoot=import.meta.hot?.data.reviewRoot??createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.reviewRoot=reviewRoot;
reviewRoot.render(<BodyReviewPanel simulationUrl={query.get('bodyReviewUrl')??'http://127.0.0.1:4313'} liveUrl={query.get('deskbotUrl')??'http://127.0.0.1:4311'}/>);
