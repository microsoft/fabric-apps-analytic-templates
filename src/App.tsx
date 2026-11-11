//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { EmptyStatePreview } from "./EmptyStatePreview";

// Replace the starter content early with a simple app shell.
// Mount validated visuals in batches as they become ready.
// Then remove this import, EmptyStatePreview.tsx, and empty-state-preview-world-map.png.
function App() {
    return <EmptyStatePreview />;
}

export default App;
