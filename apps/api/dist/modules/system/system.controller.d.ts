import { SystemService } from './system.service';
export declare class SystemController {
    private readonly systemService;
    constructor(systemService: SystemService);
    getInfo(): Promise<import("./system.service").SystemInfo>;
}
