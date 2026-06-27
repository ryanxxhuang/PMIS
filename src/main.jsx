import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { StoreProvider } from './store.jsx'
import './index.css'

// HashRouter：GitHub Pages（及任何靜態主機）子路徑 + 重新整理都不會壞，免伺服器設定
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </HashRouter>
  </React.StrictMode>,
)
