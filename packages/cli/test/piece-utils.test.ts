import { describe, expect, it, vi, beforeEach } from 'vitest'
import { displayNameToKebabCase, displayNameToCamelCase, removeStartingSlashes } from '../src/lib/utils/piece-utils'

describe('CLI utils - piece-utils', () => {
    describe('displayNameToKebabCase', () => {
        it('converts space-separated words to kebab-case', () => {
            expect(displayNameToKebabCase('My Piece')).toBe('my-piece')
            expect(displayNameToKebabCase('Hello World')).toBe('hello-world')
        })

        it('handles multiple spaces', () => {
            expect(displayNameToKebabCase('Multi   Space')).toBe('multi---space')
        })

        it('handles single word', () => {
            expect(displayNameToKebabCase('Single')).toBe('single')
        })

        it('lowercases all characters', () => {
            expect(displayNameToKebabCase('UPPER CASE')).toBe('upper-case')
        })
    })

    describe('displayNameToCamelCase', () => {
        it('converts space-separated words to camelCase', () => {
            expect(displayNameToCamelCase('My Piece')).toBe('myPiece')
            expect(displayNameToCamelCase('Hello World')).toBe('helloWorld')
        })

        it('handles single word', () => {
            expect(displayNameToCamelCase('Single')).toBe('single')
        })

        it('first word is lowercase, rest capitalized', () => {
            expect(displayNameToCamelCase('First Second Third')).toBe('firstSecondThird')
        })
    })

    describe('removeStartingSlashes', () => {
        it('removes leading slash', () => {
            expect(removeStartingSlashes('/path/to/file')).toBe('path/to/file')
        })

        it('handles string without leading slash', () => {
            expect(removeStartingSlashes('path/to/file')).toBe('path/to/file')
        })

        it('handles multiple leading slashes', () => {
            expect(removeStartingSlashes('///path')).toBe('//path')
        })

        it('handles empty string', () => {
            expect(removeStartingSlashes('')).toBe('')
        })
    })
})
