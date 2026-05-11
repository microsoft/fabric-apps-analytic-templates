//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { useAppTheme } from './hooks/use-theme.ts'
import { ThemeContext } from './hooks/theme.context.ts'
import { AuthProvider } from './hooks/use-auth.tsx'

import "./global.css"

function Root() {
    const { isDark, toggleTheme } = useAppTheme();

    return (
        <ThemeContext.Provider value={{ isDark, toggleTheme }}>
            <ErrorBoundary FallbackComponent={ErrorFallback}>
                <AuthProvider>
                    <App />
                </AuthProvider>
            </ErrorBoundary>
        </ThemeContext.Provider>
    );
}

createRoot(document.getElementById('root')!).render(<Root />)
