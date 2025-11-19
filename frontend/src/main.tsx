import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { AuthProvider } from "react-oidc-context";

const redirectUri = import.meta.env.PROD
  ? "https://menu-combo.peiwen.dev/" // 👈 確認這是你 Cloudflare 的網址
  : "http://localhost:5173/";

const cognitoAuthConfig = {
  authority: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_FEaytr2dj",
  client_id: "2db2nfb6pnt886n0pfq1uhsb6t",
  redirect_uri: redirectUri,
  post_logout_redirect_uri: redirectUri,
  response_type: "code",
  scope: "email openid phone",
  // Cognito specific metadata
  metadata: {
    issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_FEaytr2dj",
    authorization_endpoint: "https://us-east-1feaytr2dj.auth.us-east-1.amazoncognito.com/oauth2/authorize",
    token_endpoint: "https://us-east-1feaytr2dj.auth.us-east-1.amazoncognito.com/oauth2/token",
    userinfo_endpoint: "https://us-east-1feaytr2dj.auth.us-east-1.amazoncognito.com/oauth2/userInfo",
    end_session_endpoint: "https://us-east-1feaytr2dj.auth.us-east-1.amazoncognito.com/logout",
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider {...cognitoAuthConfig}>
      <App />
    </AuthProvider>
  </StrictMode>,
)
