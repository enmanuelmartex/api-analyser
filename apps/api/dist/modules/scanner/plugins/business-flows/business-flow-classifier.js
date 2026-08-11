"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyBusinessFlow = classifyBusinessFlow;
exports.isHighImpactFlow = isHighImpactFlow;
exports.flowKindLabel = flowKindLabel;
const tokenise_1 = require("../shared/tokenise");
const PROBED_METHODS = ['POST', 'PUT', 'PATCH'];
const FLOW_TERMS = {
    PAYMENT: [
        'payment', 'pay', 'charge', 'checkout', 'billing', 'invoice', 'transfer',
        'withdraw', 'withdrawal', 'topup', 'refund', 'payout', 'transaction',
        'wallet', 'deposit',
    ],
    ORDER: [
        'order', 'cart', 'purchase', 'buy', 'basket', 'subscription', 'subscribe',
        'upgrade', 'renewal', 'renew',
    ],
    BOOKING: [
        'booking', 'reservation', 'reserve', 'appointment', 'ticket', 'seat', 'slot',
    ],
    REWARD: [
        'coupon', 'promo', 'promotion', 'voucher', 'discount', 'redeem',
        'redemption', 'reward', 'loyalty', 'referral', 'gift', 'claim',
    ],
    MESSAGING: [
        'message', 'sms', 'email', 'mail', 'notification', 'notify', 'broadcast',
        'invite', 'invitation', 'share',
    ],
    ACCOUNT: [
        'register', 'registration', 'signup', 'otp', 'activate', 'activation',
        'enroll', 'enrollment', 'verify', 'verification', 'password', 'resend',
    ],
    CONTENT: ['comment', 'review', 'rating', 'vote', 'post', 'upload', 'follow'],
};
const KIND_PRIORITY = [
    'PAYMENT', 'ORDER', 'BOOKING', 'REWARD', 'MESSAGING', 'ACCOUNT', 'CONTENT',
];
const HIGH_IMPACT_KINDS = [
    'PAYMENT', 'ORDER', 'BOOKING', 'REWARD', 'MESSAGING',
];
function findTerm(tokens) {
    const present = new Set(tokens);
    for (const kind of KIND_PRIORITY) {
        for (const term of FLOW_TERMS[kind]) {
            if (present.has(term))
                return { kind, term };
        }
    }
    return null;
}
function classifyBusinessFlow(endpoint) {
    if (!PROBED_METHODS.includes(endpoint.method?.toUpperCase()))
        return null;
    const fromPath = findTerm((0, tokenise_1.tokenise)(endpoint.path ?? ''));
    if (fromPath)
        return { ...fromPath, matchedIn: 'path' };
    const fromSummary = findTerm((0, tokenise_1.tokenise)(endpoint.summary ?? ''));
    if (fromSummary)
        return { ...fromSummary, matchedIn: 'summary' };
    for (const tag of endpoint.tags ?? []) {
        const fromTag = findTerm((0, tokenise_1.tokenise)(tag));
        if (fromTag)
            return { ...fromTag, matchedIn: 'tag' };
    }
    return null;
}
function isHighImpactFlow(kind) {
    return HIGH_IMPACT_KINDS.includes(kind);
}
function flowKindLabel(kind) {
    switch (kind) {
        case 'PAYMENT': return 'payment';
        case 'ORDER': return 'ordering';
        case 'BOOKING': return 'booking';
        case 'REWARD': return 'promotion';
        case 'MESSAGING': return 'messaging';
        case 'ACCOUNT': return 'account';
        case 'CONTENT': return 'content submission';
    }
}
//# sourceMappingURL=business-flow-classifier.js.map