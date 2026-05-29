
# Fabric Apps - Analytics Template

> **⚠️ This repository is under active development.** Features and instructions may change.

This is a starter template for building Fabric Apps - Analytics web apps. Clone this repo locally and follow the steps below to get started.


## Prerequisites

1. **Node.js (v22)**: Download and install from https://nodejs.org/dist/v22.22.2/node-v22.22.2-x64.msi
2. **GitHub Copilot CLI**: Refer to https://github.com/github/copilot-cli
3. **Playwright CLI**: Run `npm install -g @playwright/cli@latest` in Terminal
4. **Azure CLI**: Install from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest. After installation, run `az login` in your terminal to sign in to your Azure account.


## Instructions for building a new web app
1. **Open Terminal**: Open Terminal in the local folder where you want to clone this repo and create your app.
2. **Clone this repo**: Run `git clone <REPO_URL> <repo_name>`. Replace `<REPO_URL>` with this repository's URL and `<repo_name>` with the name you want for your project folder.
3. **Navigate to the repo folder**: Run `cd <repo_name>`. (Optional: Run `code` to open VS Code in that folder and open Terminal inside VS Code.)
4. **Install dependencies**: Run `npm install`.
5. **Launch Copilot**: In the Command Prompt (cmd) or PowerShell terminal run `copilot` to start the Copilot CLI. Then type a prompt for what you want to build. Include the name or dataset ID of the semantic model (from Power BI Service) that you want to use. (To get the dataset ID, copy the value between `...dataset/` and `/overview...` from the URL)
6. **Preview your app**: After LLM is done, run `npm run dev` in another terminal.
7. **Open fabric shell**: Navigate to the workspace in fabric portal and open the artifact. Then append `&devUri=http://localhost:5173` at the end.

<details>
<summary><strong>💡 Tips</strong></summary>

- Use **Shift + Tab** in Copilot to switch to **Plan mode**, where Copilot will present a plan and ask for confirmation before writing any code.

</details>

<details>
<summary><strong>📝 Example prompts</strong></summary>

- `Create a sales performance dashboard using the "Contoso Sales" semantic model. Include revenue KPIs, a monthly trend line chart, top 10 stores by profit, and a regional breakdown bar chart.`
- `Build an executive summary app for the "HR Analytics" model with headcount by department, attrition rate trends over the past 3 years, and a data grid of open positions sorted by days-to-fill.`
- `I want a customer insights app using dataset ID 4053a155-34a9-4b74-9bc2-e162f1b27fc7. Show customer lifetime value distribution, churn risk segmentation, and a filterable table of top accounts.`
- `Create a supply chain monitoring dashboard from the "Logistics Ops" model. I need inventory levels by warehouse, on-time delivery rate KPIs, and a heatmap of shipping delays by region and month.`
- `Build a financial reporting app using the "GL Financials" semantic model with a P&L summary, expense breakdown by cost center, and quarter-over-quarter variance charts. Add a date range filter across all visuals.`

</details>


## Need help?

If you have any questions or run into any problems, please [file an issue](../../issues) on this repository.