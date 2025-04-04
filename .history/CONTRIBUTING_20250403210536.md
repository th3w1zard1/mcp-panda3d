# Contributing to Panda3D Documentation Server

Thank you for your interest in contributing to the Panda3D Documentation Server! This guide will help you understand how to contribute effectively to this project.

## Table of Contents

- [Contributing to Panda3D Documentation Server](#contributing-to-panda3d-documentation-server)
  - [Table of Contents](#table-of-contents)
  - [Code of Conduct](#code-of-conduct)
  - [Getting Started](#getting-started)
  - [Project Structure](#project-structure)
  - [Key Components](#key-components)
    - [MCP Server Implementation](#mcp-server-implementation)
    - [Main Features](#main-features)
  - [Submitting Changes](#submitting-changes)

## Code of Conduct

Please be respectful and considerate of others when contributing to this project. We welcome contributions from everyone, regardless of skill level or background.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork to your local machine
3. Install dependencies with `npm install`
4. Build the project with `npm run build`
5. Make your changes on a new branch

## Project Structure

```shell
panda3d-docs-server/
├── src/                  # Source code
│   └── index.ts          # Main server implementation
├── build/                # Compiled JavaScript output
├── node_modules/         # Node.js dependencies
├── .vscode/              # VS Code configuration
├── .eslintrc.json        # ESLint configuration
├── .prettierrc           # Prettier configuration
├── tsconfig.json         # TypeScript configuration
├── package.json          # Project metadata and scripts
└── README.md             # Project documentation
```

## Key Components

### MCP Server Implementation

The core of this project is the MCP server implementation in `src/index.ts`. The main class is `Panda3DDocsServer`, which:

1. Sets up an MCP server with tool handlers
2. Uses Puppeteer to search the Panda3D documentation
3. Processes and formats the search results
4. Returns the formatted content through MCP

### Main Features

- **Puppeteer Integration**: Uses a headless browser to search and extract content from the Panda3D docs
- **MCP Tool Handler**: Implements the `get_docs` tool for Claude to access documentation
- **Debug Logging**: Includes comprehensive debug logging for troubleshooting

## Submitting Changes

1. Ensure your code passes all linting and format checks
2. Push your changes to your fork
3. Create a pull request to the main repository
4. Describe your changes in detail in the pull request
5. Reference any related issues

Thank you for contributing to the Panda3D Documentation Server!
