---
title: Function list
summary: Every built-in formula function, grouped by category
tags: [formula, functions, reference]
order: 35
---

Calc ships with 398 built-in functions, grouped below by category. Use your browser's find (**⌘F**) to jump to a specific name, or open the help search palette with **⌘/** and type the function name.

See [Formulas and functions](help://calc:formulas) for how to write a formula, reference cells, and read errors.

Functions and descriptions come from the underlying [HyperFormula](https://hyperformula.handsontable.com/) engine.

## Math and trigonometry

| Function | Description | Syntax |
| --- | --- | --- |
| `ABS` | Returns the absolute value of a number. | `ABS(Number)` |
| `ACOS` | Returns the inverse trigonometric cosine of a number. | `ACOS(Number)` |
| `ACOSH` | Returns the inverse hyperbolic cosine of a number. | `ACOSH(Number)` |
| `ACOT` | Returns the inverse trigonometric cotangent of a number. | `ACOT(Number)` |
| `ACOTH` | Returns the inverse hyperbolic cotangent of a number. | `ACOTH(Number)` |
| `ARABIC` | Converts a Roman numeral string into an Arabic number. | `ARABIC(String)` |
| `ASIN` | Returns the inverse trigonometric sine of a number. | `ASIN(Number)` |
| `ASINH` | Returns the inverse hyperbolic sine of a number. | `ASINH(Number)` |
| `ATAN` | Returns the inverse trigonometric tangent of a number. | `ATAN(Number)` |
| `ATAN2` | Returns the inverse trigonometric tangent of specified x and y coordinates. | `ATAN2(NumberX, NumberY)` |
| `ATANH` | Returns the inverse hyperbolic tangent of a number. | `ATANH(Number)` |
| `BASE` | Converts a positive integer to text in a specified base. | `BASE(Number, Radix, [MinimumLength])` |
| `CEILING` | Rounds a number up to the nearest multiple of Significance. | `CEILING(Number, Significance)` |
| `CEILING.MATH` | Rounds a number up to the nearest multiple of Significance. | `CEILING.MATH(Number[, Significance[, Mode]])` |
| `CEILING.PRECISE` | Rounds a number up to the nearest multiple of Significance. | `CEILING.PRECISE(Number[, Significance])` |
| `COMBIN` | Returns the number of combinations (without repetitions). | `COMBIN(Number, Number)` |
| `COMBINA` | Returns the number of combinations (with repetitions). | `COMBINA(Number, Number)` |
| `COS` | Returns the cosine of the given angle (in radians). | `COS(Number)` |
| `COSH` | Returns the hyperbolic cosine of the given value. | `COSH(Number)` |
| `COT` | Returns the cotangent of the given angle (in radians). | `COT(Number)` |
| `COTH` | Returns the hyperbolic cotangent of the given value. | `COTH(Number)` |
| `COUNTUNIQUE` | Counts the number of unique values in a list of specified values and ranges. | `COUNTUNIQUE(Value1, Value2, ...ValueN)` |
| `CSC` | Returns the cosecant of the given angle (in radians). | `CSC(Number)` |
| `CSCH` | Returns the hyperbolic cosecant of the given value. | `CSCH(Number)` |
| `DECIMAL` | Converts text in a given numeral system to a positive integer. | `DECIMAL("Text", Radix)` |
| `DEGREES` | Converts radians into degrees. | `DEGREES(Number)` |
| `EVEN` | Rounds positive numbers up to the next even integer, negative numbers down. | `EVEN(Number)` |
| `EXP` | Returns constant e raised to the power of a number. | `EXP(Number)` |
| `FACT` | Returns the factorial of a number. | `FACT(Number)` |
| `FACTDOUBLE` | Returns the double factorial of a number. | `FACTDOUBLE(Number)` |
| `FLOOR` | Rounds a number down to the nearest multiple of Significance. | `FLOOR(Number, Significance)` |
| `FLOOR.MATH` | Rounds a number down to the nearest multiple of Significance. | `FLOOR.MATH(Number[, Significance[, Mode]])` |
| `FLOOR.PRECISE` | Rounds a number down to the nearest multiple of Significance. | `FLOOR.PRECISE(Number[, Significance])` |
| `GCD` | Computes the greatest common divisor of numbers. | `GCD(Number1, Number2, ...NumberN)` |
| `INT` | Rounds a number down to the nearest integer. | `INT(Number)` |
| `ISO.CEILING` | Rounds a number up to the nearest multiple of Significance. | `ISO.CEILING(Number[, Significance])` |
| `LCM` | Computes the least common multiple of numbers. | `LCM(Number1, Number2, ...NumberN)` |
| `LN` | Returns the natural logarithm (base e) of a number. | `LN(Number)` |
| `LOG` | Returns the logarithm of a number to the specified base. | `LOG(Number, Base)` |
| `LOG10` | Returns the base-10 logarithm of a number. | `LOG10(Number)` |
| `MOD` | Returns the remainder when one integer is divided by another. | `MOD(Dividend, Divisor)` |
| `MROUND` | Rounds a number to the nearest multiple of Base. | `MROUND(Number, Base)` |
| `MULTINOMIAL` | Returns the number of multiset combinations. | `MULTINOMIAL(Number1, Number2, ...NumberN)` |
| `ODD` | Rounds positive numbers up to the next odd integer, negative numbers down. | `ODD(Number)` |
| `PI` | Returns 3.14159265358979, the value of the mathematical constant pi. | `PI()` |
| `POWER` | Returns a number raised to another number. | `POWER(Base, Exponent)` |
| `PRODUCT` | Returns the product of numbers. | `PRODUCT(Number1, Number2, ...NumberN)` |
| `QUOTIENT` | Returns the integer part of a division. | `QUOTIENT(Dividend, Divisor)` |
| `RADIANS` | Converts degrees to radians. | `RADIANS(Number)` |
| `RAND` | Returns a random number between 0 and 1. | `RAND()` |
| `RANDBETWEEN` | Returns a random integer between two numbers (inclusive). | `RANDBETWEEN(LowerBound, UpperBound)` |
| `ROMAN` | Converts a number to a Roman numeral. | `ROMAN(Number[, Mode])` |
| `ROUND` | Rounds a number to a certain number of decimal places. | `ROUND(Number, Count)` |
| `ROUNDDOWN` | Rounds a number down, toward zero, to a given precision. | `ROUNDDOWN(Number, Count)` |
| `ROUNDUP` | Rounds a number up, away from zero, to a given precision. | `ROUNDUP(Number, Count)` |
| `SEC` | Returns the secant of the given angle (in radians). | `SEC(Number)` |
| `SECH` | Returns the hyperbolic secant of the given value. | `SECH(Number)` |
| `SERIESSUM` | Evaluates a power series at a point. | `SERIESSUM(X, N, M, Coefficients)` |
| `SIN` | Returns the sine of the given angle (in radians). | `SIN(Number)` |
| `SINH` | Returns the hyperbolic sine of the given value. | `SINH(Number)` |
| `SIGN` | Returns the sign of a number (-1, 0, or 1). | `SIGN(Number)` |
| `SQRT` | Returns the positive square root of a number. | `SQRT(Number)` |
| `SQRTPI` | Returns the square root of a number multiplied by pi. | `SQRTPI(Number)` |
| `SUBTOTAL` | Computes an aggregation using the function specified by the number. | `SUBTOTAL(Function, Number1, Number2, ...NumberN)` |
| `SUM` | Sums up the values of the specified cells. | `SUM(Number1, Number2, ...NumberN)` |
| `SUMIF` | Sums cells that meet a specified condition within a range. | `SUMIF(Range, Criteria, SumRange)` |
| `SUMIFS` | Sums cells meeting multiple condition sets within ranges. | `SUMIFS(SumRange, CriterionRange1, Criterion1 [, ...])` |
| `SUMPRODUCT` | Multiplies corresponding elements in arrays and returns the sum. | `SUMPRODUCT(Array1, Array2, ...ArrayN)` |
| `SUMSQ` | Returns the sum of the squares of the arguments. | `SUMSQ(Number1, Number2, ...NumberN)` |
| `SUMX2MY2` | Returns the sum of the differences of squares of paired values. | `SUMX2MY2(Range1, Range2)` |
| `SUMX2PY2` | Returns the sum of the sums of squares of paired values. | `SUMX2PY2(Range1, Range2)` |
| `SUMXMY2` | Returns the sum of the squares of differences between paired values. | `SUMXMY2(Range1, Range2)` |
| `TAN` | Returns the tangent of the given angle (in radians). | `TAN(Number)` |
| `TANH` | Returns the hyperbolic tangent of the given value. | `TANH(Number)` |
| `TRUNC` | Truncates a number by removing decimal places. | `TRUNC(Number, Count)` |

## Logical

| Function | Description | Syntax |
| --- | --- | --- |
| `AND` | Returns TRUE if all arguments are TRUE. | `AND(LogicalValue1, LogicalValue2, ...LogicalValueN)` |
| `FALSE` | Returns the logical value FALSE. | `FALSE()` |
| `IF` | Returns one value if a test is TRUE, another if it is FALSE. | `IF(Test, ThenValue, OtherwiseValue)` |
| `IFS` | Evaluates multiple logical tests and returns the value for the first TRUE condition. | `IFS(Condition1, Value1 [, Condition2, Value2 [, ...]])` |
| `IFNA` | Returns Value unless it is the #N/A error, in which case returns AlternateValue. | `IFNA(Value, AlternateValue)` |
| `IFERROR` | Returns Value unless it is an error, in which case returns AlternateValue. | `IFERROR(Value, AlternateValue)` |
| `NOT` | Inverts a logical value. | `NOT(LogicalValue)` |
| `OR` | Returns TRUE if at least one argument is TRUE. | `OR(LogicalValue1, LogicalValue2, ...LogicalValueN)` |
| `SWITCH` | Returns the result corresponding to the first matching value. | `SWITCH(Expression, Value1, Result1 [, Value2, Result2 [, ..., DefaultResult]])` |
| `TRUE` | Returns the logical value TRUE. | `TRUE()` |
| `XOR` | Returns TRUE if an odd number of arguments evaluate to TRUE. | `XOR(LogicalValue1, LogicalValue2, ...LogicalValueN)` |

## Text

| Function | Description | Syntax |
| --- | --- | --- |
| `CHAR` | Converts a number into a character according to the code table. | `CHAR(Number)` |
| `CLEAN` | Returns text cleaned of line breaks and non-printable characters. | `CLEAN("Text")` |
| `CODE` | Returns a numeric code for the first character in a string. | `CODE("Text")` |
| `CONCATENATE` | Combines several text strings into one string. | `CONCATENATE("Text1", "Text2", ..."TextN")` |
| `EXACT` | Returns TRUE if both text strings are exactly the same. | `EXACT(Text1, Text2)` |
| `FIND` | Returns the location of one text string inside another (case-sensitive). | `FIND("FindText", "WithinText"[, StartNumber])` |
| `LEFT` | Extracts a given number of characters from the left side of a string. | `LEFT("Text", Number)` |
| `LEN` | Returns the length of a given text. | `LEN("Text")` |
| `LOWER` | Returns text converted to lowercase. | `LOWER(Text)` |
| `MID` | Returns a substring of a given length from a start position. | `MID(Text, StartPosition, Length)` |
| `N` | Converts a value to a number. | `N(Value)` |
| `PROPER` | Capitalizes the first letter of each word in a string. | `PROPER("Text")` |
| `REPLACE` | Replaces a substring of a given length starting at a position. | `REPLACE(Text, StartPosition, Length, NewText)` |
| `REPT` | Repeats text a given number of times. | `REPT("Text", Number)` |
| `RIGHT` | Extracts a given number of characters from the right side of a string. | `RIGHT("Text", Number)` |
| `SEARCH` | Returns the location of a search string inside text (case-insensitive). | `SEARCH(SearchString, Text[, StartPosition])` |
| `SPLIT` | Divides text using a space as the separator and returns the substring at an index. | `SPLIT(Text, Index)` |
| `SUBSTITUTE` | Returns text where old text has been replaced by new text. | `SUBSTITUTE(Text, OldText, NewText, [Occurrence])` |
| `T` | Returns the text if the value is text; otherwise returns an empty string. | `T(Value)` |
| `TEXT` | Converts a number into text according to a given format. | `TEXT(Number, Format)` |
| `TRIM` | Strips extra spaces from text. | `TRIM("Text")` |
| `UNICHAR` | Returns the character created from a given code point. | `UNICHAR(Number)` |
| `UNICODE` | Returns the Unicode code point of the first character of a string. | `UNICODE(Text)` |
| `UPPER` | Returns text converted to uppercase. | `UPPER(Text)` |
| `VALUE` | Parses a number, date, time, or currency from a text string. | `VALUE(Text)` |

## Date and time

| Function | Description | Syntax |
| --- | --- | --- |
| `DATE` | Returns the specified date as a serial number (days since the null date). | `DATE(Year, Month, Day)` |
| `DATEDIF` | Calculates the distance between two dates in a given unit. | `DATEDIF(Date1, Date2, Unit)` |
| `DATEVALUE` | Parses a date string and returns days since the null date. | `DATEVALUE(DateString)` |
| `DAY` | Returns the day of the given date value. | `DAY(Number)` |
| `DAYS` | Calculates the difference between two date values, in days. | `DAYS(Date2, Date1)` |
| `DAYS360` | Calculates the difference between dates using a 360-day year. | `DAYS360(Date2, Date1[, Format])` |
| `EDATE` | Shifts a start date by a number of months and returns the serial date. | `EDATE(StartDate, Months)` |
| `EOMONTH` | Returns the last day of the month a given number of months from the start date. | `EOMONTH(StartDate, Months)` |
| `HOUR` | Returns the hour component of a given time. | `HOUR(Time)` |
| `INTERVAL` | Returns an ISO 8601 interval string from a number of seconds. | `INTERVAL(Seconds)` |
| `ISOWEEKNUM` | Returns the ISO 8601 week number for the date. | `ISOWEEKNUM(Date)` |
| `MINUTE` | Returns the minute component of a given time. | `MINUTE(Time)` |
| `MONTH` | Returns the month for the given date value. | `MONTH(Number)` |
| `NETWORKDAYS` | Returns the number of working days between two dates. | `NETWORKDAYS(Date1, Date2[, Holidays])` |
| `NETWORKDAYS.INTL` | Returns the number of working days between two dates with a custom weekend. | `NETWORKDAYS.INTL(Date1, Date2[, Mode [, Holidays]])` |
| `NOW` | Returns the current date and time as a serial number. | `NOW()` |
| `SECOND` | Returns the second component of a given time. | `SECOND(Time)` |
| `TIME` | Returns a number representing the given time as a fraction of a day. | `TIME(Hour, Minute, Second)` |
| `TIMEVALUE` | Parses a time string and returns a number as a fraction of a day. | `TIMEVALUE(TimeString)` |
| `TODAY` | Returns the integer representing the current date. | `TODAY()` |
| `WEEKDAY` | Returns a number between 1 and 7 representing the day of the week. | `WEEKDAY(Date, Type)` |
| `WEEKNUM` | Returns the week number for a given date. | `WEEKNUM(Date, Type)` |
| `WORKDAY` | Returns the working day a given number of days from a start date. | `WORKDAY(Date, Shift[, Holidays])` |
| `WORKDAY.INTL` | Returns the working day a given number of days from a start date with a custom weekend. | `WORKDAY.INTL(Date, Shift[, Mode[, Holidays]])` |
| `YEAR` | Returns the year for the given date value. | `YEAR(Number)` |
| `YEARFRAC` | Computes the difference between dates as a fraction of years. | `YEARFRAC(Date2, Date1[, Format])` |

## Statistical

| Function | Description | Syntax |
| --- | --- | --- |
| `AVEDEV` | Returns the average absolute deviation of the arguments from their mean. | `AVEDEV(Number1, Number2, ...NumberN)` |
| `AVERAGE` | Returns the arithmetic mean of the arguments. | `AVERAGE(Number1, Number2, ...NumberN)` |
| `AVERAGEA` | Returns the arithmetic mean of the arguments (text and logical values count as 0/1). | `AVERAGEA(Value1, Value2, ...ValueN)` |
| `AVERAGEIF` | Returns the arithmetic mean of cells satisfying a condition. | `AVERAGEIF(Range, Criterion [, AverageRange])` |
| `BESSELI` | Returns the value of the modified Bessel function In(x). | `BESSELI(X, N)` |
| `BESSELJ` | Returns the value of the Bessel function Jn(x). | `BESSELJ(X, N)` |
| `BESSELK` | Returns the value of the modified Bessel function Kn(x). | `BESSELK(X, N)` |
| `BESSELY` | Returns the value of the Bessel function Yn(x). | `BESSELY(X, N)` |
| `BETA.DIST` | Returns the value of the beta distribution density. | `BETA.DIST(X, Alpha, Beta, Cumulative[, A[, B]])` |
| `BETADIST` | Returns the value of the beta distribution density. | `BETADIST(X, Alpha, Beta, Cumulative[, A[, B]])` |
| `BETA.INV` | Returns the inverse of the beta distribution. | `BETA.INV(Probability, Alpha, Beta[, A[, B]])` |
| `BETAINV` | Returns the inverse of the beta distribution. | `BETAINV(Probability, Alpha, Beta[, A[, B]])` |
| `BINOM.DIST` | Returns the binomial distribution density. | `BINOM.DIST(Number, Trials, Probability, Cumulative)` |
| `BINOMDIST` | Returns the binomial distribution density. | `BINOMDIST(Number, Trials, Probability, Cumulative)` |
| `BINOM.INV` | Returns the smallest value for which the cumulative binomial distribution is ≥ Alpha. | `BINOM.INV(Trials, Probability, Alpha)` |
| `CHIDIST` | Returns the right-tailed probability of the chi-squared distribution. | `CHIDIST(X, Degrees)` |
| `CHIDISTRT` | Returns the right-tailed probability of the chi-squared distribution. | `CHIDISTRT(X, Degrees)` |
| `CHIINV` | Returns the inverse of the right-tailed chi-squared distribution. | `CHIINV(Probability, Degrees)` |
| `CHIINVRT` | Returns the inverse of the right-tailed chi-squared distribution. | `CHIINVRT(Probability, Degrees)` |
| `CHISQ.DIST` | Returns the chi-squared distribution value. | `CHISQ.DIST(X, Degrees, Cumulative)` |
| `CHISQ.DIST.RT` | Returns the right-tailed probability of the chi-squared distribution. | `CHISQ.DIST.RT(X, Degrees)` |
| `CHISQ.INV` | Returns the inverse of the left-tailed chi-squared distribution. | `CHISQ.INV(Probability, Degrees)` |
| `CHISQ.INV.RT` | Returns the inverse of the right-tailed chi-squared distribution. | `CHISQ.INV.RT(Probability, Degrees)` |
| `CHISQ.TEST` | Returns the chi-squared test value for a dataset. | `CHISQ.TEST(Array1, Array2)` |
| `CHITEST` | Returns the chi-squared test value for a dataset. | `CHITEST(Array1, Array2)` |
| `CONFIDENCE` | Returns the upper confidence bound for the normal distribution. | `CONFIDENCE(Alpha, Stdev, Size)` |
| `CONFIDENCE.NORM` | Returns the upper confidence bound for the normal distribution. | `CONFIDENCE.NORM(Alpha, Stdev, Size)` |
| `CONFIDENCE.T` | Returns the upper confidence bound for the Student-t distribution. | `CONFIDENCE.T(Alpha, Stdev, Size)` |
| `CORREL` | Returns the correlation coefficient between two datasets. | `CORREL(Data1, Data2)` |
| `COUNT` | Counts how many numbers are in the list of arguments. | `COUNT(Value1, Value2, ...ValueN)` |
| `COUNTA` | Counts how many values (non-empty) are in the list of arguments. | `COUNTA(Value1, Value2, ...ValueN)` |
| `COUNTBLANK` | Returns the number of empty cells in a range. | `COUNTBLANK(Range)` |
| `COUNTIF` | Returns the count of cells in a range meeting a criterion. | `COUNTIF(Range, Criteria)` |
| `COUNTIFS` | Returns the count of cells meeting multiple criteria. | `COUNTIFS(Range1, Criterion1 [, Range2, Criterion2 [, ...]])` |
| `COVAR` | Returns the covariance between datasets (population-normalized). | `COVAR(Data1, Data2)` |
| `COVARIANCE.P` | Returns the covariance between datasets (population-normalized). | `COVARIANCE.P(Data1, Data2)` |
| `COVARIANCEP` | Returns the covariance between datasets (population-normalized). | `COVARIANCEP(Data1, Data2)` |
| `COVARIANCE.S` | Returns the covariance between datasets (sample-normalized). | `COVARIANCE.S(Data1, Data2)` |
| `COVARIANCES` | Returns the covariance between datasets (sample-normalized). | `COVARIANCES(Data1, Data2)` |
| `CRITBINOM` | Returns the inverse binomial distribution value. | `CRITBINOM(Trials, Probability, Alpha)` |
| `DEVSQ` | Returns the sum of squared deviations from the mean. | `DEVSQ(Number1, Number2, ...NumberN)` |
| `EXPON.DIST` | Returns the density of the exponential distribution. | `EXPON.DIST(X, Lambda, Cumulative)` |
| `EXPONDIST` | Returns the density of the exponential distribution. | `EXPONDIST(X, Lambda, Cumulative)` |
| `FDIST` | Returns the right-tailed probability of the F distribution. | `FDIST(X, Degree1, Degree2)` |
| `FINV` | Returns the inverse of the right-tailed F distribution. | `FINV(Probability, Degree1, Degree2)` |
| `F.DIST` | Returns the F distribution density. | `F.DIST(X, Degree1, Degree2, Cumulative)` |
| `F.DIST.RT` | Returns the right-tailed probability of the F distribution. | `F.DIST.RT(X, Degree1, Degree2)` |
| `FDISTRT` | Returns the right-tailed probability of the F distribution. | `FDISTRT(X, Degree1, Degree2)` |
| `F.INV` | Returns the inverse of the left-tailed F distribution. | `F.INV(Probability, Degree1, Degree2)` |
| `F.INV.RT` | Returns the inverse of the right-tailed F distribution. | `F.INV.RT(Probability, Degree1, Degree2)` |
| `FINVRT` | Returns the inverse of the right-tailed F distribution. | `FINVRT(Probability, Degree1, Degree2)` |
| `FISHER` | Returns the Fisher transformation value. | `FISHER(Number)` |
| `FISHERINV` | Returns the inverse of the Fisher transformation. | `FISHERINV(Number)` |
| `F.TEST` | Returns the F-test value for a dataset. | `F.TEST(Array1, Array2)` |
| `FTEST` | Returns the F-test value for a dataset. | `FTEST(Array1, Array2)` |
| `GAMMA` | Returns the value of the gamma function. | `GAMMA(Number)` |
| `GAMMA.DIST` | Returns the gamma distribution density. | `GAMMA.DIST(X, Alpha, Beta, Cumulative)` |
| `GAMMADIST` | Returns the gamma distribution density. | `GAMMADIST(X, Alpha, Beta, Cumulative)` |
| `GAMMALN` | Returns the natural logarithm of the gamma function. | `GAMMALN(Number)` |
| `GAMMALN.PRECISE` | Returns the natural logarithm of the gamma function. | `GAMMALN.PRECISE(Number)` |
| `GAMMA.INV` | Returns the inverse of the gamma distribution. | `GAMMA.INV(Probability, Alpha, Beta)` |
| `GAMMAINV` | Returns the inverse of the gamma distribution. | `GAMMAINV(Probability, Alpha, Beta)` |
| `GAUSS` | Returns the probability that a Gaussian variable is between the mean and Number standard deviations. | `GAUSS(Number)` |
| `GEOMEAN` | Returns the geometric mean of the arguments. | `GEOMEAN(Number1, Number2, ...NumberN)` |
| `HARMEAN` | Returns the harmonic mean of the arguments. | `HARMEAN(Number1, Number2, ...NumberN)` |
| `HYPGEOMDIST` | Returns the hypergeometric distribution density. | `HYPGEOMDIST(SampleS, NumberSample, PopulationS, NumberPop, Cumulative)` |
| `HYPGEOM.DIST` | Returns the hypergeometric distribution density. | `HYPGEOM.DIST(SampleS, NumberSample, PopulationS, NumberPop, Cumulative)` |
| `LARGE` | Returns the K-th largest value in a range. | `LARGE(Range, K)` |
| `LOGNORM.DIST` | Returns the lognormal distribution density. | `LOGNORM.DIST(X, Mean, Stddev, Cumulative)` |
| `LOGNORMDIST` | Returns the lognormal distribution density. | `LOGNORMDIST(X, Mean, Stddev, Cumulative)` |
| `LOGNORM.INV` | Returns the inverse of the lognormal distribution. | `LOGNORM.INV(Probability, Mean, Stddev)` |
| `LOGNORMINV` | Returns the inverse of the lognormal distribution. | `LOGNORMINV(Probability, Mean, Stddev)` |
| `LOGINV` | Returns the inverse of the lognormal distribution. | `LOGINV(Probability, Mean, Stddev)` |
| `MAX` | Returns the maximum value in a list of arguments. | `MAX(Number1, Number2, ...NumberN)` |
| `MAXA` | Returns the maximum value in a list of arguments (text and logical values count). | `MAXA(Value1, Value2, ...ValueN)` |
| `MAXIFS` | Returns the maximum value of cells meeting multiple criteria. | `MAXIFS(MaxRange, CriterionRange1, Criterion1 [, ...])` |
| `MEDIAN` | Returns the median of a set of numbers. | `MEDIAN(Number1, Number2, ...NumberN)` |
| `MIN` | Returns the minimum value in a list of arguments. | `MIN(Number1, Number2, ...NumberN)` |
| `MINA` | Returns the minimum value in a list of arguments (text and logical values count). | `MINA(Value1, Value2, ...ValueN)` |
| `MINIFS` | Returns the minimum value of cells meeting multiple criteria. | `MINIFS(MinRange, CriterionRange1, Criterion1 [, ...])` |
| `NEGBINOM.DIST` | Returns the negative binomial distribution density. | `NEGBINOM.DIST(Failures, Successes, Probability, Cumulative)` |
| `NEGBINOMDIST` | Returns the negative binomial distribution density. | `NEGBINOMDIST(Failures, Successes, Probability, Cumulative)` |
| `NORM.DIST` | Returns the normal distribution density. | `NORM.DIST(X, Mean, Stddev, Cumulative)` |
| `NORMDIST` | Returns the normal distribution density. | `NORMDIST(X, Mean, Stddev, Cumulative)` |
| `NORM.S.DIST` | Returns the standard normal distribution density. | `NORM.S.DIST(X, Cumulative)` |
| `NORMSDIST` | Returns the standard normal distribution density. | `NORMSDIST(X, Cumulative)` |
| `NORM.INV` | Returns the inverse of the normal distribution. | `NORM.INV(Probability, Mean, Stddev)` |
| `NORMINV` | Returns the inverse of the normal distribution. | `NORMINV(Probability, Mean, Stddev)` |
| `NORM.S.INV` | Returns the inverse of the standard normal distribution. | `NORM.S.INV(Probability)` |
| `NORMSINV` | Returns the inverse of the standard normal distribution. | `NORMSINV(Probability)` |
| `PEARSON` | Returns the Pearson correlation coefficient between two datasets. | `PEARSON(Data1, Data2)` |
| `PHI` | Returns the probability density of the standard normal distribution. | `PHI(X)` |
| `POISSON` | Returns the Poisson distribution density. | `POISSON(X, Mean, Cumulative)` |
| `POISSON.DIST` | Returns the Poisson distribution density. | `POISSON.DIST(X, Mean, Cumulative)` |
| `POISSONDIST` | Returns the Poisson distribution density. | `POISSONDIST(X, Mean, Cumulative)` |
| `RSQ` | Returns the squared Pearson correlation coefficient. | `RSQ(Data1, Data2)` |
| `SKEW` | Returns the skewness of a sample. | `SKEW(Number1, Number2, ...NumberN)` |
| `SKEW.P` | Returns the skewness of a population. | `SKEW.P(Number1, Number2, ...NumberN)` |
| `SKEWP` | Returns the skewness of a population. | `SKEWP(Number1, Number2, ...NumberN)` |
| `SLOPE` | Returns the slope of a linear regression line. | `SLOPE(KnownY, KnownX)` |
| `SMALL` | Returns the K-th smallest value in a range. | `SMALL(Range, K)` |
| `STANDARDIZE` | Returns a normalized value with respect to mean and standard deviation. | `STANDARDIZE(X, Mean, Stddev)` |
| `STDEV` | Returns the standard deviation of a sample. | `STDEV(Value1, Value2, ...ValueN)` |
| `STDEVA` | Returns the standard deviation of a sample (text and logical values count). | `STDEVA(Value1, Value2, ...ValueN)` |
| `STDEVP` | Returns the standard deviation of a population. | `STDEVP(Value1, Value2, ...ValueN)` |
| `STDEV.P` | Returns the standard deviation of a population. | `STDEV.P(Value1, Value2, ...ValueN)` |
| `STDEVPA` | Returns the standard deviation of a population (text and logical values count). | `STDEVPA(Value1, Value2, ...ValueN)` |
| `STDEV.S` | Returns the standard deviation of a sample. | `STDEV.S(Value1, Value2, ...ValueN)` |
| `STDEVS` | Returns the standard deviation of a sample. | `STDEVS(Value1, Value2, ...ValueN)` |
| `STEYX` | Returns the standard error of the predicted y-value. | `STEYX(KnownY, KnownX)` |
| `TDIST` | Returns the Student-t distribution density. | `TDIST(X, Degrees, Mode)` |
| `T.DIST` | Returns the Student-t distribution density. | `T.DIST(X, Degrees, Cumulative)` |
| `T.DIST.2T` | Returns the two-tailed Student-t distribution probability. | `T.DIST.2T(X, Degrees)` |
| `TDIST2T` | Returns the two-tailed Student-t distribution probability. | `TDIST2T(X, Degrees)` |
| `T.DIST.RT` | Returns the right-tailed Student-t distribution probability. | `T.DIST.RT(X, Degrees)` |
| `TDISTRT` | Returns the right-tailed Student-t distribution probability. | `TDISTRT(X, Degrees)` |
| `TINV` | Returns the inverse two-tailed Student-t distribution. | `TINV(Probability, Degrees)` |
| `T.INV` | Returns the inverse of the Student-t distribution. | `T.INV(Probability, Degrees)` |
| `T.INV.2T` | Returns the inverse two-tailed Student-t distribution. | `T.INV.2T(Probability, Degrees)` |
| `TINV2T` | Returns the inverse two-tailed Student-t distribution. | `TINV2T(Probability, Degrees)` |
| `TTEST` | Returns the t-test value for a dataset. | `TTEST(Array1, Array2)` |
| `T.TEST` | Returns the t-test value for a dataset. | `T.TEST(Array1, Array2)` |
| `VAR` | Returns the variance of a sample. | `VAR(Value1, Value2, ...ValueN)` |
| `VARA` | Returns the variance of a sample (text and logical values count). | `VARA(Value1, Value2, ...ValueN)` |
| `VARP` | Returns the variance of a population. | `VARP(Value1, Value2, ...ValueN)` |
| `VAR.P` | Returns the variance of a population. | `VAR.P(Value1, Value2, ...ValueN)` |
| `VARPA` | Returns the variance of a population (text and logical values count). | `VARPA(Value1, Value2, ...ValueN)` |
| `VAR.S` | Returns the variance of a sample. | `VAR.S(Value1, Value2, ...ValueN)` |
| `VARS` | Returns the variance of a sample. | `VARS(Value1, Value2, ...ValueN)` |
| `WEIBULL` | Returns the Weibull distribution density. | `WEIBULL(X, Alpha, Beta, Cumulative)` |
| `WEIBULL.DIST` | Returns the Weibull distribution density. | `WEIBULL.DIST(X, Alpha, Beta, Cumulative)` |
| `WEIBULLDIST` | Returns the Weibull distribution density. | `WEIBULLDIST(X, Alpha, Beta, Cumulative)` |
| `Z.TEST` | Returns the z-test value for a dataset. | `Z.TEST(Array, X[, Sigma])` |
| `ZTEST` | Returns the z-test value for a dataset. | `ZTEST(Array, X[, Sigma])` |

## Financial

| Function | Description | Syntax |
| --- | --- | --- |
| `CUMIPMT` | Returns the cumulative interest paid on a loan between two periods. | `CUMIPMT(Rate, Nper, Pv, Start, End, Type)` |
| `CUMPRINC` | Returns the cumulative principal paid on a loan between two periods. | `CUMPRINC(Rate, Nper, Pv, Start, End, Type)` |
| `DB` | Returns depreciation using the fixed-declining balance method. | `DB(Cost, Salvage, Life, Period[, Month])` |
| `DDB` | Returns depreciation using the double-declining balance method. | `DDB(Cost, Salvage, Life, Period[, Factor])` |
| `DOLLARDE` | Converts a price in fractional notation to a decimal number. | `DOLLARDE(Price, Fraction)` |
| `DOLLARFR` | Converts a decimal price to fractional notation. | `DOLLARFR(Price, Fraction)` |
| `EFFECT` | Calculates the effective annual interest rate from the nominal rate. | `EFFECT(NominalRate, NPerY)` |
| `FV` | Returns the future value of an investment. | `FV(Rate, Nper, Pmt[, Pv,[ Type]])` |
| `FVSCHEDULE` | Returns the future value of an investment based on a rate schedule. | `FVSCHEDULE(Pv, Schedule)` |
| `IPMT` | Returns the interest portion of a loan payment in a given period. | `IPMT(Rate, Per, Nper, Pv[, Fv[, Type]])` |
| `IRR` | Returns the internal rate of return for a series of cash flows. | `IRR(Values[, Guess])` |
| `ISPMT` | Returns the interest paid for a given period of an investment. | `ISPMT(Rate, Per, Nper, Value)` |
| `MIRR` | Returns the modified internal rate of return for cash flows. | `MIRR(Flows, FRate, RRate)` |
| `NOMINAL` | Returns the nominal interest rate. | `NOMINAL(EffectRate, NPerY)` |
| `NPER` | Returns the number of periods for an investment. | `NPER(Rate, Pmt, Pv[, Fv[, Type]])` |
| `NPV` | Returns the net present value of an investment. | `NPV(Rate, Value1, Value2, ...ValueN)` |
| `PDURATION` | Returns the number of periods required for an investment to reach a specific value. | `PDURATION(Rate, Pv, Fv)` |
| `PMT` | Returns the periodic payment for a loan. | `PMT(Rate, Nper, Pv[, Fv[, Type]])` |
| `PPMT` | Returns the principal portion of a loan payment. | `PPMT(Rate, Per, Nper, Pv[, Fv[, Type]])` |
| `PV` | Returns the present value of an investment. | `PV(Rate, Nper, Pmt[, Fv[, Type]])` |
| `RATE` | Returns the interest rate per period of an annuity. | `RATE(Nper, Pmt, Pv[, Fv[, Type[, Guess]]])` |
| `RRI` | Returns the equivalent interest rate for an investment growing from Pv to Fv. | `RRI(Nper, Pv, Fv)` |
| `SLN` | Returns the depreciation using the straight-line method. | `SLN(Cost, Salvage, Life)` |
| `SYD` | Returns the sum-of-years depreciation for an asset over a period. | `SYD(Cost, Salvage, Life, Period)` |
| `TBILLEQ` | Returns the bond-equivalent yield for a Treasury bill. | `TBILLEQ(Settlement, Maturity, Discount)` |
| `TBILLPRICE` | Returns the price per $100 face value for a Treasury bill. | `TBILLPRICE(Settlement, Maturity, Discount)` |
| `TBILLYIELD` | Returns the yield for a Treasury bill. | `TBILLYIELD(Settlement, Maturity, Price)` |
| `XNPV` | Returns the net present value for a schedule of irregular cash flows. | `XNPV(Rate, Payments, Dates)` |

## Lookup and reference

| Function | Description | Syntax |
| --- | --- | --- |
| `ADDRESS` | Returns a cell reference as a string. | `ADDRESS(Row, Column[, AbsoluteRelativeMode[, UseA1Notation[, Sheet]]])` |
| `CHOOSE` | Uses an index to return a value from a list of values. | `CHOOSE(Index, Value1, Value2, ...ValueN)` |
| `COLUMN` | Returns the column number of a given reference or of the formula cell. | `COLUMN([Reference])` |
| `COLUMNS` | Returns the number of columns in the given reference. | `COLUMNS(Array)` |
| `FORMULATEXT` | Returns the formula in a given cell as a string. | `FORMULATEXT(Reference)` |
| `HLOOKUP` | Searches the first row of an array for a value and returns a value from the same column. | `HLOOKUP(SearchCriterion, Array, Index, SortOrder)` |
| `HYPERLINK` | Stores a URL in the cell's metadata. | `HYPERLINK(Url[, LinkLabel])` |
| `INDEX` | Returns the contents of a cell by row and column number within a range. | `INDEX(Range, Row [, Column])` |
| `MATCH` | Returns the relative position of a matching item in an array. | `MATCH(SearchCriterion, LookupArray [, MatchType])` |
| `OFFSET` | Returns the value of a cell offset by a number of rows and columns. | `OFFSET(Reference, Rows, Columns, Height, Width)` |
| `ROW` | Returns the row number of a given reference or of the formula cell. | `ROW([Reference])` |
| `ROWS` | Returns the number of rows in the given reference. | `ROWS(Array)` |
| `VLOOKUP` | Searches the first column of an array for a value and returns a value from the same row. | `VLOOKUP(SearchCriterion, Array, Index, SortOrder)` |
| `XLOOKUP` | Searches for a key in a range and returns the closest match. | `XLOOKUP(LookupValue, LookupArray, ReturnArray, [IfNotFound], [MatchMode], [SearchMode])` |

## Information

| Function | Description | Syntax |
| --- | --- | --- |
| `ISBINARY` | Returns TRUE if the provided value is a valid binary string. | `ISBINARY(Value)` |
| `ISBLANK` | Returns TRUE if the reference to a cell is blank. | `ISBLANK(Value)` |
| `ISERR` | Returns TRUE if the value is an error other than #N/A. | `ISERR(Value)` |
| `ISERROR` | Returns TRUE if the value is any error value. | `ISERROR(Value)` |
| `ISEVEN` | Returns TRUE if the value is an even integer. | `ISEVEN(Value)` |
| `ISFORMULA` | Returns TRUE if the referenced cell contains a formula. | `ISFORMULA(Value)` |
| `ISLOGICAL` | Returns TRUE for a logical value (TRUE or FALSE). | `ISLOGICAL(Value)` |
| `ISNA` | Returns TRUE if the value is the #N/A error. | `ISNA(Value)` |
| `ISNONTEXT` | Returns TRUE if the value is not text. | `ISNONTEXT(Value)` |
| `ISNUMBER` | Returns TRUE if the value is a number. | `ISNUMBER(Value)` |
| `ISODD` | Returns TRUE if the value is an odd integer. | `ISODD(Value)` |
| `ISREF` | Returns TRUE if the value is the #REF! error. | `ISREF(Value)` |
| `ISTEXT` | Returns TRUE if the cell contents are text. | `ISTEXT(Value)` |
| `SHEET` | Returns the sheet number of a given value or of the formula's sheet. | `SHEET([Value])` |
| `SHEETS` | Returns the number of sheets in a reference or in the workbook. | `SHEETS([Value])` |
| `NA` | Returns the #N/A error value. | `NA()` |
| `VERSION` | Returns the HyperFormula version string powering the formula engine. | `VERSION()` |

## Engineering

| Function | Description | Syntax |
| --- | --- | --- |
| `BIN2DEC` | Converts a binary number to decimal. | `BIN2DEC(Number)` |
| `BIN2HEX` | Converts a binary number to hexadecimal. | `BIN2HEX(Number, Places)` |
| `BIN2OCT` | Converts a binary number to octal. | `BIN2OCT(Number, Places)` |
| `BITAND` | Returns a bitwise logical AND of two numbers. | `BITAND(Number1, Number2)` |
| `BITLSHIFT` | Shifts a number left by N bits. | `BITLSHIFT(Number, Shift)` |
| `BITOR` | Returns a bitwise logical OR of two numbers. | `BITOR(Number1, Number2)` |
| `BITRSHIFT` | Shifts a number right by N bits. | `BITRSHIFT(Number, Shift)` |
| `BITXOR` | Returns the bitwise XOR of two numbers. | `BITXOR(Number1, Number2)` |
| `COMPLEX` | Returns a complex number from real and imaginary parts. | `COMPLEX(Re, Im[, Symbol])` |
| `DEC2BIN` | Converts a decimal number to binary. | `DEC2BIN(Number, Places)` |
| `DEC2HEX` | Converts a decimal number to hexadecimal. | `DEC2HEX(Number, Places)` |
| `DEC2OCT` | Converts a decimal number to octal. | `DEC2OCT(Number, Places)` |
| `DELTA` | Returns 1 if two numbers are equal, 0 otherwise. | `DELTA(Number1, Number2)` |
| `ERF` | Returns the value of the Gauss error integral. | `ERF(LowerLimit[, UpperLimit])` |
| `ERFC` | Returns the complementary Gauss error integral. | `ERFC(LowerLimit)` |
| `HEX2BIN` | Converts a hexadecimal number to binary. | `HEX2BIN(Number, Places)` |
| `HEX2DEC` | Converts a hexadecimal number to decimal. | `HEX2DEC(Number)` |
| `HEX2OCT` | Converts a hexadecimal number to octal. | `HEX2OCT(Number, Places)` |
| `IMABS` | Returns the modulus (absolute value) of a complex number. | `IMABS(Complex)` |
| `IMAGINARY` | Returns the imaginary part of a complex number. | `IMAGINARY(Complex)` |
| `IMARGUMENT` | Returns the argument θ of a complex number. | `IMARGUMENT(Complex)` |
| `IMCONJUGATE` | Returns the conjugate of a complex number. | `IMCONJUGATE(Complex)` |
| `IMCOS` | Returns the cosine of a complex number. | `IMCOS(Complex)` |
| `IMCOSH` | Returns the hyperbolic cosine of a complex number. | `IMCOSH(Complex)` |
| `IMCOT` | Returns the cotangent of a complex number. | `IMCOT(Complex)` |
| `IMCSC` | Returns the cosecant of a complex number. | `IMCSC(Complex)` |
| `IMCSCH` | Returns the hyperbolic cosecant of a complex number. | `IMCSCH(Complex)` |
| `IMDIV` | Divides two complex numbers. | `IMDIV(Complex1, Complex2)` |
| `IMEXP` | Returns the exponent of a complex number. | `IMEXP(Complex)` |
| `IMLN` | Returns the natural logarithm of a complex number. | `IMLN(Complex)` |
| `IMLOG2` | Returns the base-2 logarithm of a complex number. | `IMLOG2(Complex)` |
| `IMLOG10` | Returns the base-10 logarithm of a complex number. | `IMLOG10(Complex)` |
| `IMPOWER` | Returns a complex number raised to a given power. | `IMPOWER(Complex, Number)` |
| `IMPRODUCT` | Multiplies complex numbers. | `IMPRODUCT(Complex1, Complex2, ...ComplexN)` |
| `IMREAL` | Returns the real part of a complex number. | `IMREAL(Complex)` |
| `IMSEC` | Returns the secant of a complex number. | `IMSEC(Complex)` |
| `IMSECH` | Returns the hyperbolic secant of a complex number. | `IMSECH(Complex)` |
| `IMSIN` | Returns the sine of a complex number. | `IMSIN(Complex)` |
| `IMSINH` | Returns the hyperbolic sine of a complex number. | `IMSINH(Complex)` |
| `IMSQRT` | Returns the square root of a complex number. | `IMSQRT(Complex)` |
| `IMSUB` | Subtracts two complex numbers. | `IMSUB(Complex1, Complex2)` |
| `IMSUM` | Adds complex numbers. | `IMSUM(Complex1, Complex2, ...ComplexN)` |
| `IMTAN` | Returns the tangent of a complex number. | `IMTAN(Complex)` |
| `OCT2BIN` | Converts an octal number to binary. | `OCT2BIN(Number, Places)` |
| `OCT2DEC` | Converts an octal number to decimal. | `OCT2DEC(Number)` |
| `OCT2HEX` | Converts an octal number to hexadecimal. | `OCT2HEX(Number, Places)` |

## Operator

| Function | Description | Syntax |
| --- | --- | --- |
| `HF.ADD` | Adds two values. Implements the `+` operator. | `HF.ADD(Number, Number)` |
| `HF.CONCAT` | Concatenates two strings. Implements the `&` operator. | `HF.CONCAT(String, String)` |
| `HF.DIVIDE` | Divides two values. Implements the `/` operator. | `HF.DIVIDE(Number, Number)` |
| `HF.EQ` | Tests two values for equality. Implements the `=` operator. | `HF.EQ(Value, Value)` |
| `HF.LTE` | Tests two values for the less-than-or-equal relation. Implements the `<=` operator. | `HF.LTE(Value, Value)` |
| `HF.LT` | Tests two values for the less-than relation. Implements the `<` operator. | `HF.LT(Value, Value)` |
| `HF.GTE` | Tests two values for the greater-than-or-equal relation. Implements the `>=` operator. | `HF.GTE(Value, Value)` |
| `HF.GT` | Tests two values for the greater-than relation. Implements the `>` operator. | `HF.GT(Value, Value)` |
| `HF.MINUS` | Subtracts two values. Implements the binary `-` operator. | `HF.MINUS(Number, Number)` |
| `HF.MULTIPLY` | Multiplies two values. Implements the `*` operator. | `HF.MULTIPLY(Number, Number)` |
| `HF.NE` | Tests two values for inequality. Implements the `<>` operator. | `HF.NE(Value, Value)` |
| `HF.POW` | Raises a value to a power. Implements the `^` operator. | `HF.POW(Number, Number)` |
| `HF.UMINUS` | Negates a value. Implements the unary `-` operator. | `HF.UMINUS(Number)` |
| `HF.UNARY_PERCENT` | Applies the percent operator (divides by 100). | `HF.UNARY_PERCENT(Number)` |
| `HF.UPLUS` | Applies the unary `+` operator. | `HF.UPLUS(Number)` |

## Matrix

| Function | Description | Syntax |
| --- | --- | --- |
| `MMULT` | Returns the matrix product of two arrays. | `MMULT(Array1, Array2)` |
| `MEDIANPOOL` | Returns a smaller range that is the median of a sliding window. | `MEDIANPOOL(Range, WindowSize, Stride)` |
| `MAXPOOL` | Returns a smaller range that is the maximum of a sliding window. | `MAXPOOL(Range, WindowSize, Stride)` |
| `TRANSPOSE` | Transposes the rows and columns of an array. | `TRANSPOSE(Array)` |

## Array manipulation

| Function | Description | Syntax |
| --- | --- | --- |
| `ARRAYFORMULA` | Enables array-arithmetic mode for a formula. | `ARRAYFORMULA(Formula)` |
| `FILTER` | Filters an array based on one or more boolean conditions. | `FILTER(SourceArray, BoolArray1, BoolArray2, ...BoolArrayN)` |
| `ARRAY_CONSTRAIN` | Truncates an array to the given dimensions. | `ARRAY_CONSTRAIN(Array, Height, Width)` |
