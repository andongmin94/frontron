import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import "@/globals.css";
//////////////// electron components ////////////////
import TitleBar from "frontron/components/TitleBar";
/////////////////////////////////////////////////////

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <TitleBar />
    <App />
  </>,
)
