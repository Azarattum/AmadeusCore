/**Main Script */
import App from "./components/app/app";

//Application init
const app = new App();
app.initialize();

//Proppely close application
process.on("exit", app.close.bind(app));
process.on("SIGINT", app.close.bind(app));
process.on("SIGUSR1", app.close.bind(app));
process.on("SIGUSR2", app.close.bind(app));
