import { createContext, useContext, useEffect, useState } from "react"

const ThemeProviderContext = createContext({
    theme: "system",
    setTheme: () => null,
})

export function ThemeProvider({
    children,
    defaultTheme = "system",
    storageKey = "vite-ui-theme",
    ...props
}) {
    const [theme, setThemeState] = useState(
        () => (localStorage.getItem(storageKey)) || defaultTheme
    )

    // Sync with backend config on mount
    useEffect(() => {
        const loadConfig = async () => {
            try {
                // Check if IPC is available
                if (window.ipcRenderer) {
                    const config = await window.ipcRenderer.invoke('get-config')
                    if (config.theme) {
                        setThemeState(config.theme)
                    }
                }
            } catch (e) {
                console.error("Failed to sync theme with backend:", e)
            }
        }
        loadConfig()
    }, [])

    useEffect(() => {
        const root = window.document.documentElement

        root.classList.remove("light", "dark")

        if (theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
                .matches
                ? "dark"
                : "light"

            root.classList.add(systemTheme)
            return
        }

        root.classList.add(theme)
    }, [theme])

    const setTheme = (theme) => {
        localStorage.setItem(storageKey, theme)
        setThemeState(theme)

        // Persist to backend
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('set-config', { theme }).catch(console.error)
        }
    }

    const value = {
        theme,
        setTheme,
    }

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

export const useTheme = () => {
    const context = useContext(ThemeProviderContext)

    if (context === undefined)
        throw new Error("useTheme must be used within a ThemeProvider")

    return context
}
