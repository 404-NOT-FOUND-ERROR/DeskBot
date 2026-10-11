import React from 'react';
import {createRoot} from 'react-dom/client';
import {CognitionReview} from './deskbot/CognitionReview';
createRoot(document.getElementById('root')!).render(<React.StrictMode><CognitionReview/></React.StrictMode>);
