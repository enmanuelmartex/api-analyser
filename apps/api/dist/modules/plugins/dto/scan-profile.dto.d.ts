export declare class CreateScanProfileDto {
    name: string;
    description?: string;
    icon?: string;
    enabledPlugins: string[];
    pluginConfigs?: Record<string, any>;
}
export declare class UpdateScanProfileDto {
    name?: string;
    description?: string;
    icon?: string;
    enabledPlugins?: string[];
    pluginConfigs?: Record<string, any>;
}
