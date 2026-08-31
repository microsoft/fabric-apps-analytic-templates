
# Fabric Apps - Analytics Template

> **⚠️ This repository is under active development.** Features and instructions may change.

This is a starter template for building Fabric Apps - Analytics web apps. Clone this repo locally and follow the steps below to get started.

View our [Microsoft Learn documentation](https://learn.microsoft.com/fabric/apps/data-apps-template) for more information!


## Prerequisites

1. **Node.js (v22)**: Download and install from https://nodejs.org/dist/v22.22.2/node-v22.22.2-x64.msi
1. **GitHub Copilot CLI**: Refer to https://github.com/github/copilot-cli
1. **Playwright CLI**: Run `npm install -g @playwright/cli@latest` in Terminal
1. **Azure CLI**: Install from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest. After installation, run `az login` in your terminal to sign in to your Azure account.

## Instructions for building a new web app

1. **Open Terminal**: Open Terminal in the local folder where you want to clone this repo and create your app.
1. **Clone this repo**: Run `git clone <REPO_URL> <repo_name>`. Replace `<REPO_URL>` with this repository's URL and `<repo_name>` with the name you want for your project folder.
1. **Navigate to the repo folder**: Run `cd <repo_name>`. (Optional: Run `code` to open VS Code in that folder and open Terminal inside VS Code.)
1. **Install dependencies**: Run `npm install`.
1. **Launch Copilot**: Run `copilot` to start the Copilot CLI. Then type a prompt for what you want to build. Include the dataset ID of the semantic model (from Power BI Service) that you want to use and the URI of the Fabric workspace where the app should be provisioned. (To get the dataset ID, copy the value between `...dataset/` and `/overview...` from the URL.)
1. **Preview your app**: After Copilot is done, run `npm run dev` and leave the development server running.
1. **Open Fabric shell**: Navigate to the workspace in Fabric portal and open the artifact. Then append `&devUri=http://localhost:5173` at the end. This allows you to preview your app.
1. **Deploy or update the app**: When you are ready to publish the latest changes, run `npx rayfin up --workspace-uri "<workspace-uri>"` using your Fabric workspace URL. Users with access to that workspace can then open the updated app.

<details>
<summary><strong>💡 Tips</strong></summary>

- Use **Shift + Tab** in Copilot to switch to **Plan mode**, where Copilot will present a plan and ask for confirmation before writing any code.

</details>

<details>
<summary><strong>📝 Example prompts</strong></summary>

> When using any example below, include the semantic model ID and the URI of the Fabric workspace where the app should be provisioned. Ex. `Semantic model ID: 12345678-1234-1234-1234-123456789abc Fabric workspace: https://fabric.microsoft.com/groups/12345678-1234-1234-1234-123456789abc`

- `Create a sales performance dashboard using the "Contoso Sales" semantic model. Include revenue KPIs, a monthly trend line chart, top 10 stores by profit, and a regional breakdown bar chart.`
- `Build an executive summary app for the "HR Analytics" model with headcount by department, attrition rate trends over the past 3 years, and a data grid of open positions sorted by days-to-fill.`
- `I want a customer insights app. Show customer lifetime value distribution, churn risk segmentation, and a filterable table of top accounts.`
- `Create a supply chain monitoring dashboard from the "Logistics Ops" model. I need inventory levels by warehouse, on-time delivery rate KPIs, and a heatmap of shipping delays by region and month.`
- `Build a financial reporting app using the "GL Financials" semantic model with a P&L summary, expense breakdown by cost center, and quarter-over-quarter variance charts. Add a date range filter across all visuals.`

</details>


## Need help?

If you have any questions or run into any problems, please [file an issue](../../issues) on this repository.