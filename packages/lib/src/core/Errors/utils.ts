import { ERROR_ACTION_BLUR_SCENARIO, ERROR_ACTION_FOCUS_FIELD, ErrorCodePrefixes, SF_ErrorCodes } from './constants';
import { SFError } from '../../components/Card/components/CardInput/types';
import { SortErrorsObj, SortedErrorObject, GenericError, SetSRMessagesReturnObject } from './types';
import { ValidationRuleResult } from '../../utils/Validator/ValidationRuleResult';
import { ErrorMessageObject } from '../../utils/Validator/types';
import {
    ENCRYPTED_CARD_NUMBER,
    ENCRYPTED_EXPIRY_DATE,
    ENCRYPTED_EXPIRY_MONTH,
    ENCRYPTED_EXPIRY_YEAR,
    ENCRYPTED_PWD_FIELD,
    ENCRYPTED_SECURITY_CODE
} from '../../components/internal/SecuredFields/lib/constants';
import { AriaConfigObject } from '../../components/internal/SecuredFields/lib/types';
import type Language from '../../language';

/**
 * Extract and translate all the errorCodes related to a specific securedField
 * @param i18n
 * @param errorCodeIdentifier - the identifier for which type of errorCodes we need to collect e.g. 'cc-num'
 */
export const getTranslatedErrors = (i18n: Language, errorCodeIdentifier: string): Record<SF_ErrorCodes, string> => {
    const transObj = Object.values(SF_ErrorCodes).reduce((acc, value) => {
        // Limit to errors related to specific sf
        if (value.includes(errorCodeIdentifier)) {
            acc[value] = i18n.get(value);
        }
        return acc;
    }, {}) as Record<SF_ErrorCodes, string>;

    return transObj;
};

/**
 * Adds a new error property to an object.
 * This error property is an object containing the translated errors, stored by code, that relate to the securedFields
 * @param originalObject - object we want to duplicate and enhance
 * @param i18n - an i18n object to use to get translations
 * @returns a duplicate of the original object with a new property: "error" whose value is a object containing the translated errors
 */
export const addErrorTranslationsToObject = (originalObj: AriaConfigObject, i18n: Language, fieldType: string): AriaConfigObject => {
    const nuObj: AriaConfigObject = { ...originalObj };

    const errorCodeIdentifier = fieldTypeToErrorCodeIdentifier(fieldType);
    nuObj.error = getTranslatedErrors(i18n, errorCodeIdentifier);

    return nuObj;
};

export const getErrorMessageFromCode = (errorCode: string, codeMap: Record<string, string>): string => {
    let errMsg = errorCode;
    for (const [key, value] of Object.entries(codeMap)) {
        if (value === errorCode) {
            errMsg = key;
            break;
        }
    }
    return errMsg?.toLowerCase().replace(/[_.\s]/g, '-');
};

/**
 * errorCodeIdentifiers must match the prefixes to the numbers in ERROR_CODES (Errors/constants.ts)
 * (Which in turn must match the keys in the translations files)
 */
const fieldTypeToErrorCodeIdentifier = (fieldType: string): string => {
    let errorCodeIdentifier;
    switch (fieldType) {
        case ENCRYPTED_CARD_NUMBER:
            errorCodeIdentifier = ErrorCodePrefixes.CC_NUM;
            break;
        case ENCRYPTED_EXPIRY_DATE:
            errorCodeIdentifier = ErrorCodePrefixes.CC_DAT;
            break;
        case ENCRYPTED_EXPIRY_MONTH:
            errorCodeIdentifier = ErrorCodePrefixes.CC_MTH;
            break;
        case ENCRYPTED_EXPIRY_YEAR:
            errorCodeIdentifier = ErrorCodePrefixes.CC_YR;
            break;
        case ENCRYPTED_SECURITY_CODE:
            errorCodeIdentifier = ErrorCodePrefixes.CC_CVC;
            break;
        case ENCRYPTED_PWD_FIELD:
            errorCodeIdentifier = ErrorCodePrefixes.KCP_PWD;
            break;
        default:
    }
    return errorCodeIdentifier;
};

/**
 * sortErrorsByLayout - takes a list of errors and a layout, and returns a sorted array of error objects with translated error messages
 *
 * @param errors - an object containing errors, referenced by field type
 * @param layout - a string[] controlling how the output error objects will be ordered. Required when it is known that the way the error object is populated can vary e.g. Card comp, &/or anything with a country selector
 * @param i18n - our internal Language mechanism
 * @param countrySpecificLabels - some errors are region specific, e.g. in the US "postal code" = "zip code", so map the fieldType value accordingly (if it is being added to the errorMessage string)
 * @param fieldTypeMappingFn - a component specific lookup function that will tell us both if we need to prepend the field type to the SR panel message, and, if so, will retrieve the correct translation for the field type
 */
export const sortErrorsByLayout = ({ errors, i18n, layout, countrySpecificLabels, fieldTypeMappingFn }: SortErrorsObj): SortedErrorObject[] => {
    const SR_INDICATOR_PREFIX = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test' ? '' : '-sr'; // Useful for testing whether SR is reading out aria-live errors (sr) or aria-describedby ones

    // Create array of error objects, sorted by layout
    const sortedErrors: SortedErrorObject[] = Object.entries(errors).reduce((acc, [key, value]) => {
        if (value) {
            const errObj: ValidationRuleResult | SFError | GenericError = errors[key];

            const TREAT_AS_SF_ERROR = 'errorI18n' in errObj && `rootNode` in errObj; // look for expected props, unique to an SFError

            // Some ValidationRuleResults can be passed an object in the 'errorMessage' prop (to give country specific errors)
            const ERROR_MSG_IS_OBJECT = typeof errObj.errorMessage === 'object';

            /**
             * Get error codes - these are used if we need to distinguish between showValidation & onBlur errors
             * - For a ValidationRuleResult or GenericError the error "code" is contained in the errorMessage prop.
             * - For an SFError the error "code" is contained in the error prop.
             */
            let errorCode: string;
            if (TREAT_AS_SF_ERROR) {
                errorCode = errObj.error;
            } else {
                /** Special handling for Address~postalCode (where the errorMessage is an object) */
                if (ERROR_MSG_IS_OBJECT) {
                    /** is ValidationRuleResult w. country specific error */
                    errorCode = (errObj.errorMessage as ErrorMessageObject).translationKey;
                } else {
                    /** is ValidationRuleResult || GenericError || an as yet incorrectly formed error */
                    errorCode = errObj.errorMessage as string;
                }
            }

            /**
             * Get corresponding error msg - a translated string we can place into the SRPanel
             * NOTE: the error object for a secured field already contains the error in a translated form (errorI18n).
             * For other fields we still need to translate it, so we use the errObj.errorMessage prop as a translation key
             */
            let errorMsg: string;
            if (TREAT_AS_SF_ERROR && 'errorI18n' in errObj) {
                errorMsg = errObj.errorI18n + SR_INDICATOR_PREFIX;
            } else {
                /**
                 * For some fields, for a11y reasons (when the translated error msg doesn't contain a reference to the field it refers to), we need to
                 * add the field type into the translated error message.
                 *
                 * This happens with generic errors
                 *  e.g. "field.error.required": "Enter the %{label}"
                 *   or "invalid.format.expects": "%{label} Invalid format. Expected format: %{format}"
                 */
                const mappedLabel = fieldTypeMappingFn ? fieldTypeMappingFn(key, i18n, countrySpecificLabels) : ''; // Retrieve the translated field name, if required

                /** Special handling for Address~postalCode where the errorMessage object contains the details of the country specific format that should have been used for the postcode */
                if (ERROR_MSG_IS_OBJECT) {
                    /**  is ValidationRuleResult  w. country specific error */
                    const translationKey = (errObj.errorMessage as ErrorMessageObject).translationKey;
                    const countrySpecificFormat = (errObj.errorMessage as ErrorMessageObject).translationObject.values.format;

                    errorMsg = `${i18n.get(translationKey, { values: { label: mappedLabel, format: countrySpecificFormat } })}${SR_INDICATOR_PREFIX}`;
                } else {
                    /** is ValidationRuleResult || GenericError || an as yet incorrectly formed error */
                    errorMsg = i18n.get(errObj.errorMessage as string, { values: { label: mappedLabel } }) + SR_INDICATOR_PREFIX;
                }
            }

            acc.push({ field: key, errorMessage: errorMsg, errorCode });

            if (layout) acc.sort((a, b) => layout.indexOf(a.field) - layout.indexOf(b.field));
        }
        return acc;
    }, []);

    return sortedErrors;
};

/**
 * Implemented as a partial, with an object containing the first 6 arguments; then the final argument, errors, is passed to the partial
 *
 * NOTE: using this generic error setting fny is only suitable when errors for the SRPanel are *only* generated by showValidation().
 * When errors are also generated onBlur, as the user leaves the input, the SR message generation becomes more complex - see CardInput as an example
 */
export const setSRMessagesFromErrors = (
    { i18n, fieldTypeMappingFn, SRPanelRef },
    { errors, isValidating, layout, countrySpecificLabels }
): SetSRMessagesReturnObject => {
    const currentErrorsSortedByLayout = sortErrorsByLayout({
        errors,
        i18n,
        fieldTypeMappingFn,
        countrySpecificLabels,
        layout
    });

    const doLog = false;

    if (doLog) console.log('### setSRMessagesFromErrors::currentErrorsSortedByLayout:: ', currentErrorsSortedByLayout);

    if (currentErrorsSortedByLayout.length) {
        /** If validating i.e. "on submit" type event - then display all errors in the SR panel */
        if (isValidating) {
            const errorMsgArr: string[] = currentErrorsSortedByLayout.map(errObj => errObj.errorMessage);
            if (doLog) console.log('### setSRMessagesFromErrors:: #1 multiple errors:: (validating) errorMsgArr=', errorMsgArr);
            SRPanelRef.setMessages(errorMsgArr);

            const fieldListArr: string[] = currentErrorsSortedByLayout.map(errObj => errObj.field);
            return { currentErrorsSortedByLayout, action: ERROR_ACTION_FOCUS_FIELD, fieldToFocus: fieldListArr[0] };
        } else {
            // prettier-ignore
            if (doLog) console.log('### setSRMessagesFromErrors:: #3 on blur scenario:: not validating but there might be an error, either to set or to clear');
            SRPanelRef?.setMessages(null);

            return { currentErrorsSortedByLayout, action: ERROR_ACTION_BLUR_SCENARIO }; // on blur scenario: not validating but there might be an error, either to set or to clear
        }
    } else {
        if (doLog) console.log('### setSRMessagesFromErrors::componentDidUpdate:: #4 clearing errors:: NO currentErrorsSortedByLayout');
        SRPanelRef?.setMessages(null); // no errors - so clear SR panel
        return { currentErrorsSortedByLayout, action: 'none' };
    }
};

export const enhanceErrorObjectKeys = (errorObj, keyPrefix) => {
    if (!errorObj) return null;
    const enhancedObj = Object.entries(errorObj).reduce((acc, [key, value]) => {
        if (value) {
            const newKey = `${keyPrefix}${key}`;
            acc[newKey] = value;
        }
        return acc;
    }, {});

    return enhancedObj;
};
