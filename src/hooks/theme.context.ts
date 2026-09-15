//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { createContext, useContext } from "react";
import type { VisualTheme } from "@microsoft/fabric-visuals-core";

interface ThemeContextValue {
    isDark: boolean;
    toggleTheme: () => void;
    theme: VisualTheme;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useThemeContext(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useThemeContext must be used within a ThemeContext.Provider");
    }
    return context;
}
