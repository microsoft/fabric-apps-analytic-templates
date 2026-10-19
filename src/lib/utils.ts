//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS class names with conflict resolution.
 *
 *   cn("px-2 py-1", isActive && "bg-brand text-on-brand")
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
