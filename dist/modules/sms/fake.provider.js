"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeSmsProvider = void 0;
class FakeSmsProvider {
    name = 'fake';
    sentMessages = [];
    async sendPattern(input) {
        this.sentMessages.push(input);
        return {
            success: true,
            messageId: `FAKE-MSG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            rawResponse: { status: 'mocked_ok' }
        };
    }
    clear() {
        this.sentMessages = [];
    }
}
exports.FakeSmsProvider = FakeSmsProvider;
