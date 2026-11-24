/** Tabs the assistant (Luna) screens hide because nothing backs them there. */
export declare const LUNA_HIDDEN_RIGHT_TABS: readonly string[];

export declare function isAssistantPath(pathname: string): boolean;

/** False when `tab` is one of the tabs Luna's screens deliberately hide. */
export declare function isRightTabVisible(pathname: string, tab: string): boolean;
