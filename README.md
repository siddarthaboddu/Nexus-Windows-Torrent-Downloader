# Nexus - Windows Torrent Downloader

<div align="center">

![Version](https://img.shields.io/badge/version-0.9.3-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A modern, beautiful, and feature-rich torrent client built with Electron, React, and WebTorrent.

</div>

---

## 📋 Table of Contents

- [Features](#-features)
- [Screenshots](#-screenshots)
- [Technology Stack](#-technology-stack)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Development](#-development)
- [Building](#-building)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### Core Functionality
- **Torrent Management**: Add torrents via magnet links, `.torrent` files, or URLs
- **Download Control**: Pause, resume, and remove torrents with ease
- **File Verification**: Re-verify torrent integrity to ensure data correctness
- **Session Persistence**: Automatically restore active torrents on application restart
- **Smart State Management**: Maintains download progress even when paused

### User Interface
- **Modern Design**: Beautiful glassmorphism UI with smooth animations
- **Dark Theme**: Eye-friendly dark mode with vibrant accent colors
- **Real-time Statistics**: Live download/upload speeds, peer counts, and progress tracking
- **Compact Mode**: Toggle between detailed and compact torrent list views
- **Custom Titlebar**: Frameless window with custom controls for a native feel

### Advanced Features
- **System Tray Integration**: Minimize to tray and quick access from taskbar
- **Speed Limiting**: Configure download and upload speed limits
- **Network Configuration**: Customize torrent port settings
- **Power Management**: Insomnia mode prevents system sleep during downloads
- **Notifications**: Desktop notifications for completed downloads
- **Auto-start**: Optional launch on Windows startup
- **Folder Management**: Quick access to download folders from the app

### Performance
- **Efficient Downloads**: Powered by WebTorrent for fast peer-to-peer transfers
- **Low Resource Usage**: Optimized for minimal CPU and memory footprint
- **Throttled State Saving**: Smart state persistence to avoid excessive disk writes

---

## 🖼️ Screenshots

> Add screenshots of your application here

---

## 🛠️ Technology Stack

### Frontend
- **React 19.2.0**: Modern UI library with hooks
- **Vite 7.2.4**: Lightning-fast build tool and dev server
- **TailwindCSS 3.4.17**: Utility-first CSS framework
- **Lucide React**: Beautiful icon library
- **Recharts**: Data visualization for statistics

### Backend
- **Electron 39.2.7**: Cross-platform desktop framework
- **WebTorrent 2.8.5**: Streaming torrent client for the web
- **Node.js**: JavaScript runtime

### Build Tools
- **Electron Builder 26.0.12**: Package and build for Windows
- **ESLint**: Code linting and quality
- **PostCSS & Autoprefixer**: CSS processing

---

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **npm** (comes with Node.js) or **yarn**
- **Git** - [Download](https://git-scm.com/)
- **Windows 10/11** (for building Windows executables)

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/nexus.git
cd nexus
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:
- React and React DOM
- Electron and Electron Builder
- WebTorrent
- TailwindCSS and related tools
- Development dependencies

---

## 💻 Development

### Start Development Server

Run the application in development mode with hot-reload:

```bash
npm run dev
```

This command:
- Starts the Vite dev server
- Launches Electron with the React app
- Enables hot module replacement (HMR)
- Opens DevTools automatically (in development)

### Development Features

- **Hot Reload**: Changes to React components update instantly
- **DevTools**: Full access to Chrome DevTools for debugging
- **Source Maps**: Easy debugging with original source code
- **Fast Refresh**: Preserves component state during updates

---

## 🏗️ Building

### Build for Production

Create a production build of the application:

```bash
npm run build
```

This command:
1. Builds the React app using Vite
2. Compiles Electron main process
3. Optimizes assets and bundles

### Create Windows Installer

Build a distributable Windows installer:

```bash
npm run dist
```

This command:
1. Runs the production build
2. Packages the app using Electron Builder
3. Creates an NSIS installer in `release/{version}/`

**Output Files:**
- `Nexus Torrent Setup {version}.exe` - Windows installer
- Unpacked application files for testing

**Installer Features:**
- Custom installation directory selection
- Start menu shortcuts
- Desktop shortcut option
- Uninstaller included

---

## 📖 Usage

### Adding Torrents

**Method 1: Magnet Link**
1. Click "Add Torrent" button
2. Paste magnet link in the input field
3. Select download destination
4. Click "Add"

**Method 2: Torrent File**
1. Click "Add Torrent" button
2. Click "Browse" to select `.torrent` file
3. Choose download location
4. Click "Add"

### Managing Downloads

- **Pause**: Click the pause icon to temporarily stop downloading
- **Resume**: Click the play icon to continue a paused download
- **Remove**: Click the trash icon to remove torrent (with option to delete files)
- **Open Folder**: Click the folder icon to open download location
- **Re-verify**: Right-click torrent and select "Verify" to check file integrity

### Monitoring Progress

The dashboard displays:
- **Active Downloads**: Number of currently downloading torrents
- **Total Download Speed**: Combined download speed across all torrents
- **Active Peers**: Total number of connected peers
- **Individual Torrent Stats**: Progress, speed, ETA, ratio, and peer count

### Settings Configuration

Access settings from the sidebar to configure:
- **Download Path**: Default download location
- **Speed Limits**: Maximum download/upload speeds
- **Network Port**: Custom port for torrent connections
- **UI Preferences**: Compact mode, minimize to tray
- **System Integration**: Start with Windows, notifications
- **Power Management**: Insomnia mode to prevent sleep

---

## ⚙️ Configuration

### Configuration File

Settings are stored in:
```
%APPDATA%\nexus\nexus-config.json
```

### Available Settings

```json
{
  "downloadPath": "C:\\Users\\YourName\\Downloads\\Nexus",
  "downloadLimit": 0,
  "uploadLimit": 0,
  "networkPort": null,
  "minimizeToTray": true,
  "startWithWindows": false,
  "showSpeedInTray": true,
  "insomniaMode": true,
  "compactMode": false,
  "torrents": []
}
```

**Setting Descriptions:**
- `downloadPath`: Default folder for downloads
- `downloadLimit`: Max download speed in bytes/sec (0 = unlimited)
- `uploadLimit`: Max upload speed in bytes/sec (0 = unlimited)
- `networkPort`: Custom port for connections (null = random)
- `minimizeToTray`: Close to tray instead of exiting
- `startWithWindows`: Launch on Windows startup
- `showSpeedInTray`: Display speeds in tray tooltip
- `insomniaMode`: Prevent sleep during downloads
- `compactMode`: Use compact torrent list view
- `torrents`: Saved torrent sessions

---

## 📁 Project Structure

```
nexus/
├── electron/                 # Electron main process
│   ├── main.js              # Main process entry point
│   └── preload.js           # Preload script for IPC
├── src/                     # React application source
│   ├── components/          # React components
│   │   ├── dashboard/       # Dashboard components
│   │   │   ├── TorrentList.jsx
│   │   │   └── Settings.jsx
│   │   ├── layout/          # Layout components
│   │   │   └── Layout.jsx
│   │   └── modals/          # Modal dialogs
│   │       ├── AddTorrentModal.jsx
│   │       └── DeleteTorrentModal.jsx
│   ├── contexts/            # React contexts
│   ├── hooks/               # Custom React hooks
│   │   └── useTorrents.js
│   ├── assets/              # Static assets
│   ├── App.jsx              # Main App component
│   ├── App.css              # App styles
│   ├── main.jsx             # React entry point
│   └── index.css            # Global styles
├── public/                  # Public assets
│   ├── tray.png            # Tray icon
│   └── icon.ico            # App icon
├── build/                   # Build resources
│   └── icon.ico            # Installer icon
├── dist/                    # Vite build output
├── dist-electron/           # Electron build output
├── release/                 # Distribution packages
├── package.json             # Project dependencies
├── vite.config.js          # Vite configuration
├── tailwind.config.js      # TailwindCSS configuration
├── postcss.config.js       # PostCSS configuration
└── README.md               # This file
```

### Key Files

- **`electron/main.js`**: Electron main process, handles IPC, WebTorrent client, system tray
- **`src/App.jsx`**: Main React component with routing and state management
- **`src/hooks/useTorrents.js`**: Custom hook for torrent operations
- **`package.json`**: Dependencies and build configuration
- **`vite.config.js`**: Vite bundler configuration
- **`tailwind.config.js`**: TailwindCSS theme customization

---

## 🔧 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build production bundle |
| `npm run dist` | Create Windows installer |
| `npm run lint` | Run ESLint code linting |
| `npm run preview` | Preview production build |

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit your changes**: `git commit -m 'Add amazing feature'`
4. **Push to the branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

### Development Guidelines

- Follow existing code style and conventions
- Use ESLint for code quality
- Test thoroughly before submitting PR
- Update documentation for new features
- Write clear commit messages

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🙏 Acknowledgments

- **WebTorrent** - For the amazing torrent streaming library
- **Electron** - For making cross-platform desktop apps possible
- **React** - For the powerful UI framework
- **TailwindCSS** - For the beautiful utility-first CSS
- **Lucide** - For the clean icon set

---

## 📞 Support

If you encounter any issues or have questions:

1. Check existing [Issues](https://github.com/yourusername/nexus/issues)
2. Create a new issue with detailed information
3. Include error messages and steps to reproduce

---

<div align="center">

**Made with ❤️ by [Your Name]**

⭐ Star this repo if you find it helpful!

</div>
